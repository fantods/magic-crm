import { randomUUID } from 'node:crypto';
import type { ColumnType, SchemaEventType, SourceEvidence } from '@formless/contracts';
import { verifyEvidence } from './evidence.js';
import { canonicalColumnName, canonicalTableName, mergeAliases } from './naming.js';
import {
  architectProposalSchema,
  reviewerDecisionSchema,
  type ArchitectFieldProposal,
  type ArchitectProposal,
  type ReviewerDecision,
  type ReviewerFieldDecision,
} from './model-contracts.js';
import type { NormalizedEmail } from './normalize-email.js';
import { findColumnById, findTableById, type SchemaSnapshot } from './schema-snapshot.js';
import { ColumnValueError, validateConstrainedValue } from './values.js';

export type IdGenerator = () => string;

export interface PlannedSchemaEvent {
  readonly eventType: SchemaEventType;
  readonly payload: Record<string, unknown>;
}

export interface PlannedTable {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly aliases: readonly string[];
  readonly isNew: boolean;
}

export interface PlannedColumn {
  readonly id: string;
  readonly tableId: string;
  readonly name: string;
  readonly type: ColumnType;
  readonly description?: string;
  readonly aliases: readonly string[];
  readonly unit?: string;
  readonly enumValues?: readonly string[];
  readonly isNew: boolean;
  readonly mergedFrom?: string;
}

export interface RejectedFieldPlan {
  readonly fieldKey: string;
  readonly proposal: ArchitectFieldProposal;
  readonly reason: string;
}

export interface IngestionPlan {
  readonly table: PlannedTable;
  readonly columns: readonly PlannedColumn[];
  readonly record: {
    readonly tableId: string;
    readonly data: Record<string, unknown>;
    readonly evidence: Record<string, SourceEvidence[]>;
  };
  readonly events: readonly PlannedSchemaEvent[];
  readonly rejectedFields: readonly RejectedFieldPlan[];
  readonly schemaRevision: number;
}

export class ReviewerRejectionError extends Error {
  constructor(readonly decision: ReviewerDecision) {
    super(decision.table.rationale);
    this.name = 'ReviewerRejectionError';
  }
}

function findSemanticColumn(
  tableColumns: readonly {
    id: string;
    name: string;
    aliases: readonly string[];
  }[],
  candidateName: string,
): { id: string } | undefined {
  const canonical = canonicalColumnName(candidateName);
  return tableColumns.find(
    (column) =>
      canonicalColumnName(column.name) === canonical ||
      column.aliases.some((alias) => canonicalColumnName(alias) === canonical),
  );
}

function isCompatibleType(existing: ColumnType, proposed: ColumnType): boolean {
  return existing === proposed;
}

function decisionKey(decision: ReviewerFieldDecision): string {
  return decision.fieldKey;
}

function rejectField(
  events: PlannedSchemaEvent[],
  rejectedFields: RejectedFieldPlan[],
  proposal: ArchitectFieldProposal,
  reason: string,
): void {
  rejectedFields.push({
    fieldKey: proposal.key,
    proposal,
    reason,
  });
  events.push({
    eventType: 'column_rejected',
    payload: {
      fieldKey: proposal.key,
      proposedName: proposal.columnName,
      proposedType: proposal.type,
      reason,
    },
  });
}

export function calculateIngestionPlan(input: {
  email: NormalizedEmail;
  schema: SchemaSnapshot;
  proposal: ArchitectProposal;
  decision: ReviewerDecision;
  currentSchemaRevision?: number;
  generateId?: IdGenerator;
}): IngestionPlan {
  const proposal = architectProposalSchema.parse(input.proposal);
  const decision = reviewerDecisionSchema.parse(input.decision);
  const generateId = input.generateId ?? randomUUID;
  const currentRevision = input.currentSchemaRevision ?? 0;
  const events: PlannedSchemaEvent[] = [];
  const rejectedFields: RejectedFieldPlan[] = [];
  const plannedColumns: PlannedColumn[] = [];
  const data: Record<string, unknown> = {};
  const evidence: Record<string, SourceEvidence[]> = {};

  if (decision.table.action === 'reject') {
    throw new ReviewerRejectionError(decision);
  }

  let tableId: string;
  let tableName: string;
  let tableDescription: string | undefined;
  let tableAliases: readonly string[];
  let isNewTable = false;

  if (decision.table.action === 'use_existing') {
    const table = findTableById(input.schema, decision.table.tableId);
    if (!table) {
      throw new Error(`Reviewer selected nonexistent table ${decision.table.tableId}`);
    }
    tableId = table.id;
    tableName = table.name;
    tableAliases = table.aliases;
  } else {
    tableId = generateId();
    tableName = canonicalTableName(decision.table.name);
    tableDescription = decision.table.description;
    tableAliases = mergeAliases(decision.table.aliases);
    isNewTable = true;
    events.push({
      eventType: 'table_proposed',
      payload:
        proposal.table.kind === 'new'
          ? {
              name: proposal.table.name,
              description: proposal.table.description ?? null,
              aliases: proposal.table.aliases,
            }
          : { tableId: proposal.table.tableId },
    });
    events.push({
      eventType: 'table_accepted',
      payload: {
        tableId,
        name: tableName,
        description: tableDescription ?? null,
        aliases: tableAliases,
        rationale: decision.table.rationale,
      },
    });
  }

  const selectedTable = isNewTable
    ? { id: tableId, name: tableName, aliases: tableAliases, columns: [] }
    : findTableById(input.schema, tableId)!;

  const proposalFields = new Map(proposal.fields.map((field) => [field.key, field]));
  const decisionFields = new Map(
    decision.fields.map((decision) => [decisionKey(decision), decision]),
  );

  for (const key of proposalFields.keys()) {
    if (!decisionFields.has(key)) {
      throw new Error(`Reviewer did not review architect field ${key}`);
    }
  }

  for (const key of decisionFields.keys()) {
    if (!proposalFields.has(key)) {
      throw new Error(`Reviewer reviewed nonexistent architect field ${key}`);
    }
  }

  const usedColumnIds = new Set<string>();
  const usedCanonicalNames = new Set<string>();

  for (const proposalField of proposal.fields) {
    const fieldDecision = decisionFields.get(proposalField.key)!;

    if (fieldDecision.action === 'reject') {
      rejectField(events, rejectedFields, proposalField, fieldDecision.rationale);
      continue;
    }

    const verifiedEvidence = verifyEvidence(input.email, proposalField.evidence);
    if (!verifiedEvidence) {
      rejectField(
        events,
        rejectedFields,
        proposalField,
        'Source evidence was not present in the normalized email',
      );
      continue;
    }

    if (fieldDecision.action === 'map_existing') {
      const existingColumn = findColumnById(selectedTable, fieldDecision.existingColumnId);
      if (!existingColumn) {
        rejectField(
          events,
          rejectedFields,
          proposalField,
          'Reviewer selected a column outside the chosen table',
        );
        continue;
      }
      if (!isCompatibleType(existingColumn.type, proposalField.type)) {
        rejectField(
          events,
          rejectedFields,
          proposalField,
          `Existing column ${existingColumn.name} has incompatible type ${existingColumn.type}`,
        );
        continue;
      }
      if (usedColumnIds.has(existingColumn.id)) {
        rejectField(
          events,
          rejectedFields,
          proposalField,
          `Another field already populated column ${existingColumn.name}`,
        );
        continue;
      }

      try {
        data[existingColumn.id] = validateConstrainedValue(
          existingColumn.type,
          proposalField.value,
          existingColumn.enumValues,
        );
      } catch (error) {
        const reason =
          error instanceof ColumnValueError
            ? error.message
            : 'Column value validation unexpectedly failed';
        rejectField(events, rejectedFields, proposalField, reason);
        continue;
      }

      evidence[existingColumn.id] = [verifiedEvidence];
      usedColumnIds.add(existingColumn.id);
      plannedColumns.push({
        id: existingColumn.id,
        tableId,
        name: existingColumn.name,
        type: existingColumn.type,
        aliases: mergeAliases(existingColumn.aliases, [
          proposalField.columnName,
          proposalField.evidence.text,
        ]),
        ...(existingColumn.unit === undefined ? {} : { unit: existingColumn.unit }),
        ...(existingColumn.enumValues === undefined
          ? {}
          : { enumValues: existingColumn.enumValues }),
        isNew: false,
        mergedFrom: proposalField.columnName,
      });
      events.push({
        eventType: 'column_merged',
        payload: {
          columnId: existingColumn.id,
          fieldKey: proposalField.key,
          alias: proposalField.columnName,
          rationale: fieldDecision.rationale,
        },
      });
      continue;
    }

    const canonicalName = canonicalColumnName(fieldDecision.columnName);
    const semanticExisting =
      findSemanticColumn(selectedTable.columns, fieldDecision.columnName) ??
      findSemanticColumn(selectedTable.columns, proposalField.columnName);

    if (semanticExisting) {
      const existingColumn = findColumnById(selectedTable, semanticExisting.id);
      if (!existingColumn) {
        rejectField(
          events,
          rejectedFields,
          proposalField,
          'Semantic column lookup was inconsistent',
        );
        continue;
      }
      if (!isCompatibleType(existingColumn.type, fieldDecision.type)) {
        rejectField(
          events,
          rejectedFields,
          proposalField,
          `Existing column ${existingColumn.name} has incompatible type ${existingColumn.type}`,
        );
        continue;
      }
      if (usedColumnIds.has(existingColumn.id)) {
        rejectField(
          events,
          rejectedFields,
          proposalField,
          `Another field already populated column ${existingColumn.name}`,
        );
        continue;
      }

      try {
        data[existingColumn.id] = validateConstrainedValue(
          existingColumn.type,
          proposalField.value,
          existingColumn.enumValues,
        );
      } catch (error) {
        const reason =
          error instanceof ColumnValueError
            ? error.message
            : 'Column value validation unexpectedly failed';
        rejectField(events, rejectedFields, proposalField, reason);
        continue;
      }

      evidence[existingColumn.id] = [verifiedEvidence];
      usedColumnIds.add(existingColumn.id);
      plannedColumns.push({
        id: existingColumn.id,
        tableId,
        name: existingColumn.name,
        type: existingColumn.type,
        aliases: mergeAliases(existingColumn.aliases, [
          proposalField.columnName,
          fieldDecision.columnName,
          proposalField.evidence.text,
        ]),
        ...(existingColumn.unit === undefined ? {} : { unit: existingColumn.unit }),
        ...(existingColumn.enumValues === undefined
          ? {}
          : { enumValues: existingColumn.enumValues }),
        isNew: false,
        mergedFrom: proposalField.columnName,
      });
      events.push({
        eventType: 'column_merged',
        payload: {
          columnId: existingColumn.id,
          fieldKey: proposalField.key,
          alias: proposalField.columnName,
          rationale: `Merged into existing semantic match ${existingColumn.name}`,
        },
      });
      continue;
    }

    if (usedCanonicalNames.has(canonicalName)) {
      rejectField(
        events,
        rejectedFields,
        proposalField,
        `Another field already created column ${canonicalName}`,
      );
      continue;
    }

    const columnId = generateId();
    let value: unknown;
    try {
      value = validateConstrainedValue(
        fieldDecision.type,
        proposalField.value,
        fieldDecision.enumValues,
      );
    } catch (error) {
      const reason =
        error instanceof ColumnValueError
          ? error.message
          : 'Column value validation unexpectedly failed';
      rejectField(events, rejectedFields, proposalField, reason);
      continue;
    }

    data[columnId] = value;
    evidence[columnId] = [verifiedEvidence];
    usedColumnIds.add(columnId);
    usedCanonicalNames.add(canonicalName);
    plannedColumns.push({
      id: columnId,
      tableId,
      name: canonicalName,
      type: fieldDecision.type,
      aliases: mergeAliases([
        proposalField.columnName,
        fieldDecision.columnName,
        proposalField.evidence.text,
      ]),
      ...(fieldDecision.enumValues === undefined ? {} : { enumValues: fieldDecision.enumValues }),
      isNew: true,
    });
    events.push({
      eventType: 'column_proposed',
      payload: {
        fieldKey: proposalField.key,
        columnId,
        name: proposalField.columnName,
        type: proposalField.type,
        evidence: proposalField.evidence,
      },
    });
    events.push({
      eventType: 'column_accepted',
      payload: {
        fieldKey: proposalField.key,
        columnId,
        name: canonicalName,
        type: fieldDecision.type,
        aliases: mergeAliases([
          proposalField.columnName,
          fieldDecision.columnName,
          proposalField.evidence.text,
        ]),
        enumValues: fieldDecision.enumValues ?? null,
        rationale: fieldDecision.rationale,
      },
    });
  }

  events.push({
    eventType: 'record_created',
    payload: {
      tableId,
      columnIds: plannedColumns.map((column) => column.id),
      rejectedFieldKeys: rejectedFields.map((field) => field.fieldKey),
    },
  });

  return {
    table: {
      id: tableId,
      name: tableName,
      ...(tableDescription === undefined ? {} : { description: tableDescription }),
      aliases: tableAliases,
      isNew: isNewTable,
    },
    columns: plannedColumns,
    record: {
      tableId,
      data,
      evidence,
    },
    events,
    rejectedFields,
    schemaRevision: currentRevision + events.length,
  };
}
