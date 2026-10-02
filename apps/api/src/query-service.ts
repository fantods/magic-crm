import {
  naturalLanguageQueryInputSchema,
  queryPlanOutputSchema,
  queryResponseSchema,
  recordSchema,
  type QueryPlanOutput,
  type QueryResponse,
  type RecordQuery,
} from '@formless/contracts';
import {
  QueryCompileError,
  compileRecordQuery,
  findTableById,
  type QueryPlannerModel,
  type SchemaSnapshot,
} from '@formless/core';
import {
  FormlessDatabase,
  SchemaCatalogRepository,
  WorkspaceRepository,
  mapRecordRow,
  type WorkspaceSchema,
} from '@formless/database';
import { ZodError } from 'zod';

export interface QueryServiceOptions {
  readonly database: FormlessDatabase;
  readonly planner: QueryPlannerModel;
}

/** Thrown when the requested table does not exist in the workspace. */
export class QueryTableNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryTableNotFoundError';
  }
}

/** Thrown when the workspace does not exist. */
export class QueryWorkspaceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryWorkspaceNotFoundError';
  }
}

/**
 * Thrown when the planner's output violates the query contract: an invalid
 * DSL shape, an unknown table or column id, or a mismatch with the requested
 * table. These are model-output failures, not client-input failures.
 */
export class QueryPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryPlanError';
  }
}

export interface RunQueryInput {
  readonly workspaceId: string;
  readonly question: string;
  readonly tableId?: string;
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

/**
 * Milestone 6 query orchestration (PLAN.md, "Query system").
 *
 * Safety rules in order of enforcement:
 * 1. the workspace must exist and the optional selected table must belong to
 *    it, before any model call;
 * 2. the model emits a structured `RecordQuery` (never SQL), validated with
 *    Zod; the workspace is injected by the server, never chosen by the model;
 * 3. the planner's table and column ids are checked against the workspace's
 *    catalog before compilation;
 * 4. the compiler produces one parameterized SELECT with workspace isolation
 *    and a limit capped at 200;
 * 5. execution runs inside a `READ ONLY` transaction, so a defect could not
 *    mutate data even if the compiled statement were wrong.
 */
export class QueryService {
  private readonly workspaces = new WorkspaceRepository();
  private readonly catalog = new SchemaCatalogRepository();

  constructor(private readonly options: QueryServiceOptions) {}

  async runQuery(input: RunQueryInput): Promise<QueryResponse> {
    // Validate the input shape before opening any database work.
    const request = naturalLanguageQueryInputSchema.parse({
      question: input.question,
      ...(input.tableId === undefined ? {} : { tableId: input.tableId }),
    });

    const schema = await this.options.database.withReadOnlyTransaction(async (client) => {
      const workspace = await this.workspaces.get(client, input.workspaceId);
      if (!workspace) {
        throw new QueryWorkspaceNotFoundError(`Workspace ${input.workspaceId} was not found`);
      }
      const workspaceSchema = await this.catalog.getSchema(client, input.workspaceId);
      if (
        request.tableId !== undefined &&
        !workspaceSchema.tables.some(({ table }) => table.id === request.tableId)
      ) {
        throw new QueryTableNotFoundError(
          `Record table ${request.tableId} was not found in workspace ${input.workspaceId}`,
        );
      }
      return workspaceSchema;
    });

    const snapshot = toSchemaSnapshot(schema);
    const plan = await this.requireValidPlan(
      await this.options.planner.plan({
        question: request.question,
        schema: snapshot,
        ...(request.tableId === undefined ? {} : { tableId: request.tableId }),
      }),
    );

    const table = findTableById(snapshot, plan.query.tableId);
    if (!table) {
      throw new QueryPlanError(
        `The planner selected table ${plan.query.tableId}, which does not exist in workspace ${input.workspaceId}`,
      );
    }
    if (request.tableId !== undefined && plan.query.tableId !== request.tableId) {
      throw new QueryPlanError(
        `The planner selected table ${plan.query.tableId} instead of the requested table ${request.tableId}`,
      );
    }

    const query: RecordQuery = { ...plan.query, workspaceId: input.workspaceId };
    let compiled;
    try {
      compiled = compileRecordQuery({ query, columns: table.columns });
    } catch (error) {
      if (error instanceof QueryCompileError) {
        throw new QueryPlanError(error.message);
      }
      throw error;
    }

    const result = await this.options.database.withReadOnlyTransaction((client) =>
      client.query(compiled.text, [...compiled.params]),
    );
    const records = result.rows.map(mapRecordRow).map((record) => recordSchema.parse(record));

    return queryResponseSchema.parse({
      query: { ...query, limit: compiled.limit },
      interpretation: plan.interpretation,
      warnings: plan.warnings,
      records,
    });
  }

  /**
   * Re-validates the planner output against the shared contract, so a planner
   * implementation that skips its own validation cannot reach the compiler.
   * The OpenAI adapter and the deterministic fake already parse their output;
   * this is the engine's line of defense.
   */
  private requireValidPlan(plan: QueryPlanOutput): QueryPlanOutput {
    try {
      return queryPlanOutputSchema.parse(plan);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new QueryPlanError(error.issues.map((issue) => issue.message).join('; '));
      }
      throw error;
    }
  }
}
