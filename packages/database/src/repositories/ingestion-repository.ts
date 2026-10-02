import { ingestionStatusSchema, workspaceIdSchema, type Ingestion } from '@formless/contracts';
import { mapIngestionRow, type DatabaseExecutor } from '../mapping.js';

export interface EnsureIngestionInput {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly input: Record<string, unknown>;
}

export class IngestionRepository {
  async ensure(executor: DatabaseExecutor, input: EnsureIngestionInput): Promise<Ingestion> {
    const workspaceId = workspaceIdSchema.parse(input.workspaceId);
    const inserted = await executor.query(
      `
      INSERT INTO ingestions(workspace_id, idempotency_key, status, input)
      VALUES ($1, $2, 'pending', $3::jsonb)
      ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
      RETURNING id, workspace_id, idempotency_key, status, input, normalized, result, error, created_at, updated_at
    `,
      [workspaceId, input.idempotencyKey, JSON.stringify(input.input)],
    );

    if (inserted.rows[0]) {
      return mapIngestionRow(inserted.rows[0]);
    }

    return this.getByIdempotencyKey(executor, workspaceId, input.idempotencyKey);
  }

  async get(executor: DatabaseExecutor, ingestionId: string): Promise<Ingestion | null> {
    const result = await executor.query(
      `
        SELECT id, workspace_id, idempotency_key, status, input, normalized, result, error, created_at, updated_at
        FROM ingestions
        WHERE id = $1
      `,
      [ingestionId],
    );

    return result.rows[0] ? mapIngestionRow(result.rows[0]) : null;
  }

  /** Workspace-isolated lookup: a known ingestion id in the wrong workspace reads as missing. */
  async getInWorkspace(
    executor: DatabaseExecutor,
    workspaceId: string,
    ingestionId: string,
  ): Promise<Ingestion | null> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query(
      `
        SELECT id, workspace_id, idempotency_key, status, input, normalized, result, error, created_at, updated_at
        FROM ingestions
        WHERE workspace_id = $1 AND id = $2
      `,
      [id, ingestionId],
    );

    return result.rows[0] ? mapIngestionRow(result.rows[0]) : null;
  }

  async getByIdempotencyKey(
    executor: DatabaseExecutor,
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<Ingestion> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query(
      `
        SELECT id, workspace_id, idempotency_key, status, input, normalized, result, error, created_at, updated_at
        FROM ingestions
        WHERE workspace_id = $1 AND idempotency_key = $2
      `,
      [id, idempotencyKey],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error(`Ingestion ${idempotencyKey} was not found in workspace ${id}`);
    }

    return mapIngestionRow(row);
  }

  async markProcessing(
    executor: DatabaseExecutor,
    ingestionId: string,
    normalized?: Record<string, unknown>,
  ): Promise<Ingestion> {
    return this.updateStatus(executor, ingestionId, 'processing', {
      normalized,
    });
  }

  async markCompleted(
    executor: DatabaseExecutor,
    ingestionId: string,
    result: Record<string, unknown>,
  ): Promise<Ingestion> {
    return this.updateStatus(executor, ingestionId, 'completed', { result });
  }

  async markFailed(
    executor: DatabaseExecutor,
    ingestionId: string,
    error: string,
  ): Promise<Ingestion> {
    return this.updateStatus(executor, ingestionId, 'failed', {
      error: error.slice(0, 8_000),
    });
  }

  private async updateStatus(
    executor: DatabaseExecutor,
    ingestionId: string,
    status: Parameters<typeof ingestionStatusSchema.parse>[0],
    values: {
      normalized?: Record<string, unknown> | undefined;
      result?: Record<string, unknown>;
      error?: string;
    },
  ): Promise<Ingestion> {
    const parsedStatus = ingestionStatusSchema.parse(status);
    const result = await executor.query(
      `
      UPDATE ingestions
      SET status = $2,
          updated_at = clock_timestamp(),
          normalized = COALESCE($3::jsonb, normalized),
          result = COALESCE($4::jsonb, result),
          error = COALESCE($5, error)
      WHERE id = $1
      RETURNING id, workspace_id, idempotency_key, status, input, normalized, result, error, created_at, updated_at
    `,
      [
        ingestionId,
        parsedStatus,
        values.normalized ? JSON.stringify(values.normalized) : null,
        values.result ? JSON.stringify(values.result) : null,
        values.error ?? null,
      ],
    );

    if (!result.rows[0]) {
      throw new Error(`Ingestion ${ingestionId} was not found`);
    }

    return mapIngestionRow(result.rows[0]);
  }
}
