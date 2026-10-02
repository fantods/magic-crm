import { randomUUID } from 'node:crypto';
import { workspaceIdSchema, type Record as RecordDto } from '@formless/contracts';
import { mapRecordRow, type DatabaseExecutor } from '../mapping.js';

export interface CreateRecordInput {
  readonly workspaceId: string;
  readonly tableId: string;
  readonly data: Record<string, unknown>;
  readonly evidence: Record<string, unknown>;
  readonly source: Record<string, unknown>;
  readonly schemaRevision: number;
  readonly contentHash: string;
  readonly idempotencyKey: string;
  readonly id?: string;
}

export class RecordRepository {
  async create(executor: DatabaseExecutor, input: CreateRecordInput): Promise<RecordDto> {
    const workspaceId = workspaceIdSchema.parse(input.workspaceId);
    const id = input.id ?? randomUUID();
    const inserted = await executor.query(
      `
      INSERT INTO records(
        id,
        workspace_id,
        table_id,
        data,
        evidence,
        source,
        schema_revision,
        content_hash,
        idempotency_key
      )
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9)
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
      RETURNING id, workspace_id, table_id, data, evidence, source, schema_revision, content_hash, idempotency_key, created_at
    `,
      [
        id,
        workspaceId,
        input.tableId,
        JSON.stringify(input.data),
        JSON.stringify(input.evidence),
        JSON.stringify(input.source),
        input.schemaRevision,
        input.contentHash,
        input.idempotencyKey,
      ],
    );

    if (inserted.rows[0]) {
      return mapRecordRow(inserted.rows[0]);
    }

    const existing = await this.getByIdempotencyKey(executor, workspaceId, input.idempotencyKey);
    if (existing) {
      return existing;
    }

    throw new Error('Record insert conflicted, but no idempotent record was found');
  }

  async get(
    executor: DatabaseExecutor,
    workspaceId: string,
    recordId: string,
  ): Promise<RecordDto | null> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query(
      `
        SELECT id, workspace_id, table_id, data, evidence, source, schema_revision, content_hash, idempotency_key, created_at
        FROM records
        WHERE workspace_id = $1 AND id = $2
      `,
      [id, recordId],
    );

    return result.rows[0] ? mapRecordRow(result.rows[0]) : null;
  }

  async getByIdempotencyKey(
    executor: DatabaseExecutor,
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<RecordDto | null> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query(
      `
        SELECT id, workspace_id, table_id, data, evidence, source, schema_revision, content_hash, idempotency_key, created_at
        FROM records
        WHERE workspace_id = $1 AND idempotency_key = $2
      `,
      [id, idempotencyKey],
    );

    return result.rows[0] ? mapRecordRow(result.rows[0]) : null;
  }

  async listByTable(
    executor: DatabaseExecutor,
    workspaceId: string,
    tableId: string,
    limit = 200,
  ): Promise<RecordDto[]> {
    const id = workspaceIdSchema.parse(workspaceId);
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
    const result = await executor.query(
      `
        SELECT id, workspace_id, table_id, data, evidence, source, schema_revision, content_hash, idempotency_key, created_at
        FROM records
        WHERE workspace_id = $1 AND table_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      `,
      [id, tableId, safeLimit],
    );

    return result.rows.map(mapRecordRow);
  }
}
