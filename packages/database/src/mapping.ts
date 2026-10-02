import type { PoolClient, QueryResultRow } from 'pg';
import type {
  ColumnType,
  Ingestion,
  IngestionStatus,
  Record as RecordDto,
  RecordColumn,
  RecordSource,
  RecordTable,
  SchemaEvent,
  SchemaEventType,
  SourceEvidence,
  Workspace,
} from '@formless/contracts';

export type DatabaseExecutor = Pick<PoolClient, 'query'>;

export function toIsoDateTime(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected JSON object');
  }
  return value as Record<string, unknown>;
}

function asOptionalJsonObject(value: unknown): Record<string, unknown> | undefined {
  return value === null ? undefined : asJsonObject(value);
}

export function mapWorkspaceRow(row: QueryResultRow): Workspace {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    createdAt: toIsoDateTime(row.created_at as Date),
    updatedAt: toIsoDateTime(row.updated_at as Date),
  };
}

export function mapRecordTableRow(row: QueryResultRow): RecordTable {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    ...(row.description === null ? {} : { description: String(row.description) }),
    aliases: (row.aliases as string[]) ?? [],
    createdAt: toIsoDateTime(row.created_at as Date),
  };
}

export function mapRecordColumnRow(row: QueryResultRow): RecordColumn {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    tableId: String(row.table_id),
    name: String(row.name),
    type: String(row.type) as ColumnType,
    ...(row.description === null ? {} : { description: String(row.description) }),
    aliases: (row.aliases as string[]) ?? [],
    ...(row.unit === null ? {} : { unit: String(row.unit) }),
    ...(row.enum_values === null
      ? {}
      : { enumValues: (row.enum_values as string[] | null) ?? undefined }),
    createdAt: toIsoDateTime(row.created_at as Date),
  };
}

export function mapSchemaEventRow(row: QueryResultRow): SchemaEvent {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sequence: Number(row.sequence),
    ingestionId: String(row.ingestion_id),
    eventType: String(row.event_type) as SchemaEventType,
    payload: asJsonObject(row.payload),
    actor: asJsonObject(row.actor),
    createdAt: toIsoDateTime(row.created_at as Date),
  };
}

export function mapRecordRow(row: QueryResultRow): RecordDto {
  const evidence = asJsonObject(row.evidence);
  const mappedEvidence: Record<string, SourceEvidence[]> = {};

  for (const [key, value] of Object.entries(evidence)) {
    if (Array.isArray(value)) {
      mappedEvidence[key] = value as SourceEvidence[];
    }
  }

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    tableId: String(row.table_id),
    data: asJsonObject(row.data),
    evidence: mappedEvidence,
    source: asJsonObject(row.source) as RecordSource,
    schemaRevision: Number(row.schema_revision),
    contentHash: String(row.content_hash),
    idempotencyKey: String(row.idempotency_key),
    createdAt: toIsoDateTime(row.created_at as Date),
  };
}

export function mapIngestionRow(row: QueryResultRow): Ingestion {
  const normalized = asOptionalJsonObject(row.normalized);
  const result = asOptionalJsonObject(row.result);

  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    idempotencyKey: String(row.idempotency_key),
    status: String(row.status) as IngestionStatus,
    input: asJsonObject(row.input),
    ...(normalized === undefined ? {} : { normalized }),
    ...(result === undefined ? {} : { result }),
    ...(row.error === null ? {} : { error: String(row.error) }),
    createdAt: toIsoDateTime(row.created_at as Date),
    updatedAt: toIsoDateTime(row.updated_at as Date),
  };
}
