import type { DatabaseExecutor } from './mapping.js';

export async function acquireWorkspaceSchemaLock(
  client: DatabaseExecutor,
  workspaceId: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `schema:${workspaceId}`,
  ]);
}

export async function acquireRecordTableLock(
  client: DatabaseExecutor,
  workspaceId: string,
  tableId: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `record-table:${workspaceId}:${tableId}`,
  ]);
}
