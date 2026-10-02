import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { migrations } from './migrations/index.js';

export interface AppliedMigration {
  id: string;
  name: string;
  appliedAt: Date;
}

interface MigrationModule {
  readonly id: string;
  readonly name: string;
  readonly up: string;
  readonly down: string;
}

interface AppliedMigrationRow extends QueryResultRow {
  id: string;
  name: string;
  applied_at: Date;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

async function applyMigration(client: PoolClient, migration: MigrationModule): Promise<void> {
  const inserted = await client.query<{ id: string }>(
    `
    INSERT INTO schema_migrations(id, name)
    VALUES ($1, $2)
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `,
    [migration.id, migration.name],
  );

  if (inserted.rows.length === 0) {
    return;
  }

  await client.query(migration.up);
}

export async function runMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureMigrationTable(client);

    const applied: string[] = [];
    for (const migration of migrations) {
      const result = await client.query<{ id: string }>(
        'SELECT id FROM schema_migrations WHERE id = $1',
        [migration.id],
      );

      if (result.rowCount !== 0) {
        continue;
      }

      await applyMigration(client, migration);
      applied.push(migration.id);
    }

    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function rollbackLastMigration(pool: Pool): Promise<string | null> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureMigrationTable(client);

    const result = await client.query<AppliedMigrationRow>(
      'SELECT id, name, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 1',
    );
    const row = result.rows[0];

    if (!row) {
      await client.query('COMMIT');
      return null;
    }

    const migration = migrations.find((candidate) => candidate.id === row.id);
    if (!migration) {
      throw new Error(`Cannot find implementation for applied migration ${row.id}`);
    }

    await client.query(migration.down);
    await client.query('DELETE FROM schema_migrations WHERE id = $1', [migration.id]);
    await client.query('COMMIT');
    return migration.id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listAppliedMigrations(pool: Pool): Promise<AppliedMigration[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);

  const result = await pool.query<AppliedMigrationRow>(
    'SELECT id, name, applied_at FROM schema_migrations ORDER BY id',
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    appliedAt: new Date(row.applied_at),
  }));
}
