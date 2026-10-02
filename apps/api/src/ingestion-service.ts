import {
  emailIngestionInputSchema,
  ingestEmailResponseSchema,
  ingestionResultSchema,
  type EmailIngestionInput,
  type IngestEmailResponse,
  type RecordColumn,
  type RecordTable,
} from '@formless/contracts';
import {
  normalizeEmail,
  IngestionPlanner,
  type ArchitectModel,
  type NormalizedEmail,
  type PlannedColumn,
  type PlannedTable,
  type ReviewerModel,
  type SchemaSnapshot,
} from '@formless/core';
import {
  FormlessDatabase,
  IngestionRepository,
  RecordRepository,
  SchemaCatalogRepository,
  SchemaEventRepository,
  WorkspaceRepository,
  acquireRecordTableLock,
  type DatabaseExecutor,
  type WorkspaceSchema,
} from '@formless/database';

export interface IngestionServiceOptions {
  readonly database: FormlessDatabase;
  readonly architect: ArchitectModel;
  readonly reviewer: ReviewerModel;
  /** Operational metadata recorded as the actor on appended schema events. */
  readonly modelLabel: string;
  /** ID generator override for deterministic tests; defaults to random UUIDs. */
  readonly generateId?: () => string;
}

export interface IngestEmailOutcome {
  readonly response: IngestEmailResponse;
  /**
   * True when a previous request already completed this exact email (same
   * derived or supplied idempotency key) and its stored result was returned
   * without re-running the pipeline.
   */
  readonly replayed: boolean;
}

/** Thrown when the requested schema change races a committed conflicting one. */
export class SchemaConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaConflictError';
  }
}

/** Thrown when an email that passed schema validation cannot be normalized. */
export class InvalidEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEmailError';
  }
}

function toSchemaSnapshot(schema: WorkspaceSchema): SchemaSnapshot {
  return {
    tables: schema.tables.map(({ table, columns }) => ({
      id: table.id,
      name: table.name,
      aliases: table.aliases,
      columns: columns.map((column) => ({
        id: column.id,
        name: column.name,
        type: column.type,
        aliases: column.aliases,
        ...(column.unit === undefined ? {} : { unit: column.unit }),
        ...(column.enumValues === undefined ? {} : { enumValues: column.enumValues }),
      })),
    })),
  };
}

function randomUuid(): string {
  return crypto.randomUUID();
}

/**
 * Milestone 5 ingestion orchestration.
 *
 * Each accepted email runs through one transaction: insert or find the
 * ingestion row by idempotency key, return the stored result immediately on
 * replay, acquire the transaction-level advisory lock for the logical table,
 * append schema events, update the schema projection, insert the record, and
 * commit once. Model passes run inside the transaction because the API is
 * synchronous in v1 (PLAN.md, "Transactions and concurrency").
 */
export class IngestionService {
  private readonly planner: IngestionPlanner;
  private readonly workspaces = new WorkspaceRepository();
  private readonly ingestions = new IngestionRepository();
  private readonly schemaEvents = new SchemaEventRepository();
  private readonly catalog = new SchemaCatalogRepository();
  private readonly records = new RecordRepository();

  constructor(private readonly options: IngestionServiceOptions) {
    this.planner = new IngestionPlanner(
      options.architect,
      options.reviewer,
      options.generateId ?? randomUuid,
    );
  }

  async ingestEmail(input: EmailIngestionInput): Promise<IngestEmailOutcome> {
    // Validate and derive the idempotency key before any database work so
    // malformed input never opens a transaction.
    const email = emailIngestionInputSchema.parse(input);
    let normalized: NormalizedEmail;
    try {
      normalized = normalizeEmail(email);
    } catch (error) {
      throw new InvalidEmailError(
        error instanceof Error ? error.message : 'Email could not be normalized',
      );
    }

    return this.options.database.withTransaction(async (client) => {
      await this.workspaces.ensure(client, email.workspaceId);
      const ingestion = await this.ingestions.ensure(client, {
        workspaceId: email.workspaceId,
        idempotencyKey: normalized.idempotencyKey,
        input: { ...email },
      });

      if (ingestion.status === 'completed' && ingestion.result !== undefined) {
        const stored = ingestionResultSchema.parse(ingestion.result);
        return {
          replayed: true,
          response: ingestEmailResponseSchema.parse({
            ingestion,
            schemaDelta: stored.schemaDelta,
            record: stored.record,
          }),
        };
      }

      const schema = await this.catalog.getSchema(client, email.workspaceId);
      const schemaRevision = await this.schemaEvents.currentRevision(client, email.workspaceId);
      const planned = await this.planner.plan(email, toSchemaSnapshot(schema), schemaRevision);
      const plan = planned.plan;

      // The lock key is the logical table the plan settled on, per the plan's
      // `workspace_id:record_table_id` scheme; it serializes concurrent
      // ingests touching the same table across API processes.
      await acquireRecordTableLock(client, email.workspaceId, plan.table.id);

      const actor = { source: 'ingestion-api', model: this.options.modelLabel };
      await this.schemaEvents.append(client, {
        workspaceId: email.workspaceId,
        ingestionId: ingestion.id,
        events: plan.events.map((event) => ({
          eventType: event.eventType,
          payload: event.payload,
          actor,
        })),
      });

      const table = await this.projectTable(client, email.workspaceId, plan.table);
      const { newColumns, mergedColumns } = await this.projectColumns(
        client,
        email.workspaceId,
        plan.columns,
      );

      const record = await this.records.create(client, {
        workspaceId: email.workspaceId,
        tableId: plan.record.tableId,
        data: { ...plan.record.data },
        evidence: { ...plan.record.evidence },
        source: {
          ...(normalized.subject === undefined ? {} : { subject: normalized.subject }),
          body: normalized.body,
          ...(normalized.from === undefined ? {} : { from: normalized.from }),
          ...(normalized.to === undefined ? {} : { to: normalized.to }),
          ...(normalized.receivedAt === undefined ? {} : { receivedAt: normalized.receivedAt }),
        },
        schemaRevision: plan.schemaRevision,
        contentHash: normalized.contentHash,
        idempotencyKey: normalized.idempotencyKey,
      });

      const result = ingestionResultSchema.parse({
        schemaDelta: {
          table,
          tableCreated: plan.table.isNew,
          newColumns,
          mergedColumns,
          schemaRevision: plan.schemaRevision,
        },
        record,
      });
      const completed = await this.ingestions.markCompleted(
        client,
        ingestion.id,
        result as unknown as Record<string, unknown>,
      );
      const response = ingestEmailResponseSchema.parse({
        ingestion: completed,
        schemaDelta: result.schemaDelta,
        record: result.record,
      });

      return { replayed: false, response };
    });
  }

  /**
   * Records a failed ingestion in its own transaction after the main one
   * rolled back, so the workspace keeps a visible failed attempt. Best
   * effort: recording failures must never mask the original error.
   */
  async recordFailure(input: EmailIngestionInput, message: string): Promise<void> {
    try {
      const email = emailIngestionInputSchema.parse(input);
      const normalized = normalizeEmail(email);
      await this.options.database.withTransaction(async (client) => {
        await this.workspaces.ensure(client, email.workspaceId);
        const ingestion = await this.ingestions.ensure(client, {
          workspaceId: email.workspaceId,
          idempotencyKey: normalized.idempotencyKey,
          input: { ...email },
        });
        if (ingestion.status !== 'completed') {
          await this.ingestions.markFailed(client, ingestion.id, message);
        }
      });
    } catch {
      // Swallow: the original error is reported to the caller.
    }
  }

  private async projectTable(
    executor: DatabaseExecutor,
    workspaceId: string,
    plannedTable: PlannedTable,
  ): Promise<RecordTable> {
    const table = plannedTable.isNew
      ? await this.catalog.ensureTable(executor, {
          id: plannedTable.id,
          workspaceId,
          name: plannedTable.name,
          ...(plannedTable.description === undefined
            ? {}
            : { description: plannedTable.description }),
          aliases: plannedTable.aliases,
        })
      : await this.requireTable(executor, workspaceId, plannedTable.id);

    if (table.id !== plannedTable.id) {
      throw new SchemaConflictError(
        `Record table "${plannedTable.name}" already exists with id ${table.id}`,
      );
    }

    return table;
  }

  private async projectColumns(
    executor: DatabaseExecutor,
    workspaceId: string,
    plannedColumns: readonly PlannedColumn[],
  ): Promise<{ newColumns: RecordColumn[]; mergedColumns: RecordColumn[] }> {
    const newColumns: RecordColumn[] = [];
    const mergedColumns: RecordColumn[] = [];

    for (const column of plannedColumns) {
      if (column.isNew) {
        const created = await this.catalog.ensureColumn(executor, {
          id: column.id,
          workspaceId,
          tableId: column.tableId,
          name: column.name,
          type: column.type,
          ...(column.description === undefined ? {} : { description: column.description }),
          aliases: column.aliases,
          ...(column.unit === undefined ? {} : { unit: column.unit }),
          ...(column.enumValues === undefined ? {} : { enumValues: [...column.enumValues] }),
        });
        if (created.id !== column.id) {
          throw new SchemaConflictError(
            `Record column "${column.name}" already exists with id ${created.id}`,
          );
        }
        newColumns.push(created);
        continue;
      }

      const current = await this.requireColumn(executor, workspaceId, column.id);
      for (const alias of column.aliases) {
        if (!current.aliases.includes(alias)) {
          await this.catalog.mergeColumnAlias(executor, workspaceId, column.id, alias);
        }
      }
      mergedColumns.push(await this.requireColumn(executor, workspaceId, column.id));
    }

    return { newColumns, mergedColumns };
  }

  private async requireTable(
    executor: DatabaseExecutor,
    workspaceId: string,
    tableId: string,
  ): Promise<RecordTable> {
    const table = await this.catalog.getTable(executor, workspaceId, tableId);
    if (!table) {
      throw new Error(`Record table ${tableId} was not found in workspace ${workspaceId}`);
    }
    return table;
  }

  private async requireColumn(
    executor: DatabaseExecutor,
    workspaceId: string,
    columnId: string,
  ): Promise<RecordColumn> {
    const column = await this.catalog.getColumn(executor, workspaceId, columnId);
    if (!column) {
      throw new Error(`Record column ${columnId} was not found in workspace ${workspaceId}`);
    }
    return column;
  }
}
