import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrations } from './migrations/index.js';
import { listAppliedMigrations, rollbackLastMigration, runMigrations } from './migrator.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const testTimeout = 30_000;

const APPLICATION_TABLES = [
  'workspaces',
  'ingestions',
  'record_tables',
  'record_columns',
  'schema_events',
  'records',
];

/**
 * Parses the test database URL into an admin URL (the `postgres` maintenance
 * database) and an isolated scratch URL. Every connection in this file is
 * guarded to the dedicated `formless_migrator_test` database so the up/down
 * cycles can never touch the database other integration tests share.
 */
function isolatedTestDatabases(databaseUrl: string): {
  adminUrl: string;
  scratchUrl: string;
  scratchName: string;
} {
  const url = new URL(databaseUrl);
  const scratchName = 'formless_migrator_test';
  url.pathname = `/${scratchName}`;
  const scratchUrl = url.toString();
  url.pathname = '/postgres';
  return { adminUrl: url.toString(), scratchUrl, scratchName };
}

async function tableNames(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `,
  );
  return result.rows.map((row) => row.table_name);
}

describe.skipIf(!databaseUrl)('Migration up/down checks (PostgreSQL-backed)', () => {
  const scratchName = 'formless_migrator_test';
  let admin: Pool;
  let scratch: Pool;

  beforeAll(async () => {
    const { adminUrl, scratchUrl } = isolatedTestDatabases(databaseUrl!);
    admin = new Pool({ connectionString: adminUrl });
    scratch = new Pool({ connectionString: scratchUrl });
    await admin.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${scratchName}`);
  }, testTimeout);

  afterAll(async () => {
    scratch?.end();
    try {
      await admin?.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    } finally {
      admin?.end();
    }
  }, testTimeout);

  it(
    'applies every migration up, verifies the schema, rolls everything back, and re-applies',
    async () => {
      expect(migrations.length).toBeGreaterThan(0);

      // Up: every migration applies, and applying again is a no-op.
      const firstRun = await runMigrations(scratch);
      expect(firstRun).toEqual(migrations.map((migration) => migration.id));

      const secondRun = await runMigrations(scratch);
      expect(secondRun).toEqual([]);

      const applied = await listAppliedMigrations(scratch);
      expect(applied.map((migration) => migration.id)).toEqual(
        migrations.map((migration) => migration.id),
      );

      for (const table of APPLICATION_TABLES) {
        expect(await tableNames(scratch)).toContain(table);
      }

      // Criterion 7 adjacency: the append-only trigger rejects mutations on the
      // schema journal at the database level, so no application code can update
      // or delete a schema event.
      const workspaceId = `m8-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      await scratch.query('INSERT INTO workspaces(id, display_name) VALUES ($1, $2)', [
        workspaceId,
        'Migration check workspace',
      ]);
      const ingestion = await scratch.query<{ id: string }>(
        `INSERT INTO ingestions(workspace_id, idempotency_key, status, input)
       VALUES ($1, $2, 'completed', '{}'::jsonb) RETURNING id`,
        [workspaceId, `migration-${randomUUID()}`],
      );
      const event = await scratch.query<{ id: string }>(
        `INSERT INTO schema_events(workspace_id, sequence, ingestion_id, event_type, payload, actor)
       VALUES ($1, 1, $2, 'table_accepted', '{}'::jsonb, '{}'::jsonb) RETURNING id`,
        [workspaceId, ingestion.rows[0]!.id],
      );
      await expect(
        scratch.query('UPDATE schema_events SET payload = $1 WHERE id = $2', [
          JSON.stringify({ tampered: true }),
          event.rows[0]!.id,
        ]),
      ).rejects.toThrow(/append-only/);
      await expect(
        scratch.query('DELETE FROM schema_events WHERE id = $1', [event.rows[0]!.id]),
      ).rejects.toThrow(/append-only/);

      // Down: rolling back everything removes every application table and
      // clears the migration bookkeeping.
      const rolledBack: string[] = [];
      for (;;) {
        const id = await rollbackLastMigration(scratch);
        if (id === null) {
          break;
        }
        rolledBack.push(id);
      }
      expect(rolledBack).toEqual([...migrations].reverse().map((migration) => migration.id));

      for (const table of APPLICATION_TABLES) {
        expect(await tableNames(scratch)).not.toContain(table);
      }

      // Up again: the full down→up cycle leaves a working schema.
      const thirdRun = await runMigrations(scratch);
      expect(thirdRun).toEqual(migrations.map((migration) => migration.id));
      for (const table of APPLICATION_TABLES) {
        expect(await tableNames(scratch)).toContain(table);
      }
    },
    testTimeout,
  );
});
