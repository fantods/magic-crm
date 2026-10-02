import { randomUUID } from 'node:crypto';
import {
  schemaEventTypeSchema,
  workspaceIdSchema,
  type SchemaEvent,
  type SchemaEventType,
} from '@formless/contracts';
import { acquireWorkspaceSchemaLock } from '../locks.js';
import { mapSchemaEventRow, type DatabaseExecutor } from '../mapping.js';

export interface AppendSchemaEventInput {
  readonly eventType: SchemaEventType;
  readonly payload: Record<string, unknown>;
  readonly actor: Record<string, unknown>;
}

export class SchemaEventRepository {
  async append(
    executor: DatabaseExecutor,
    input: {
      workspaceId: string;
      ingestionId: string;
      events: readonly AppendSchemaEventInput[];
    },
  ): Promise<SchemaEvent[]> {
    const workspaceId = workspaceIdSchema.parse(input.workspaceId);

    if (input.events.length === 0) {
      throw new Error('At least one schema event is required');
    }

    for (const event of input.events) {
      schemaEventTypeSchema.parse(event.eventType, undefined);
    }

    // This lock is intentionally required even when the caller supplies a transaction. It keeps
    // sequence allocation serialized across multiple API processes.
    await acquireWorkspaceSchemaLock(executor, workspaceId);

    const nextResult = await executor.query<{ next_sequence: number }>(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM schema_events WHERE workspace_id = $1',
      [workspaceId],
    );
    let sequence = Number(nextResult.rows[0]!.next_sequence);
    const createdEvents: SchemaEvent[] = [];

    for (const event of input.events) {
      const result = await executor.query(
        `
        INSERT INTO schema_events(
          id,
          workspace_id,
          sequence,
          ingestion_id,
          event_type,
          payload,
          actor
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
        RETURNING id, workspace_id, sequence, ingestion_id, event_type, payload, actor, created_at
      `,
        [
          randomUUID(),
          workspaceId,
          sequence,
          input.ingestionId,
          event.eventType,
          JSON.stringify(event.payload),
          JSON.stringify(event.actor),
        ],
      );

      createdEvents.push(mapSchemaEventRow(result.rows[0]!));
      sequence += 1;
    }

    return createdEvents;
  }

  async list(
    executor: DatabaseExecutor,
    workspaceId: string,
    ingestionId?: string,
  ): Promise<SchemaEvent[]> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = ingestionId
      ? await executor.query(
          `
            SELECT id, workspace_id, sequence, ingestion_id, event_type, payload, actor, created_at
            FROM schema_events
            WHERE workspace_id = $1 AND ingestion_id = $2
            ORDER BY sequence
          `,
          [id, ingestionId],
        )
      : await executor.query(
          `
            SELECT id, workspace_id, sequence, ingestion_id, event_type, payload, actor, created_at
            FROM schema_events
            WHERE workspace_id = $1
            ORDER BY sequence
          `,
          [id],
        );

    return result.rows.map(mapSchemaEventRow);
  }

  async listPage(
    executor: DatabaseExecutor,
    workspaceId: string,
    pagination: { limit?: number; offset?: number } = {},
  ): Promise<{ events: SchemaEvent[]; total: number }> {
    const id = workspaceIdSchema.parse(workspaceId);
    const limit = Math.min(Math.max(Math.trunc(pagination.limit ?? 50), 1), 200);
    const offset = Math.max(Math.trunc(pagination.offset ?? 0), 0);
    const events = await executor.query(
      `
        SELECT id, workspace_id, sequence, ingestion_id, event_type, payload, actor, created_at
        FROM schema_events
        WHERE workspace_id = $1
        ORDER BY sequence
        LIMIT $2 OFFSET $3
      `,
      [id, limit, offset],
    );
    const total = await executor.query<{ total: number }>(
      'SELECT COUNT(*) AS total FROM schema_events WHERE workspace_id = $1',
      [id],
    );

    return {
      events: events.rows.map(mapSchemaEventRow),
      total: Number(total.rows[0]!.total),
    };
  }

  async currentRevision(executor: DatabaseExecutor, workspaceId: string): Promise<number> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query<{ revision: number }>(
      'SELECT COALESCE(MAX(sequence), 0) AS revision FROM schema_events WHERE workspace_id = $1',
      [id],
    );

    return Number(result.rows[0]!.revision);
  }
}
