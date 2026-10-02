import { Pool } from 'pg';
import { resolveDatabaseConfig } from '../config.js';
import { listAppliedMigrations, rollbackLastMigration, runMigrations } from '../migrator.js';

const command = process.argv[2] ?? 'up';

if (command !== 'up' && command !== 'down' && command !== 'status') {
  throw new Error(`Unknown migration command: ${command}. Use up, down, or status.`);
}

const config = resolveDatabaseConfig();
const pool = new Pool(config);

try {
  if (command === 'up') {
    const applied = await runMigrations(pool);
    console.log(
      applied.length === 0 ? 'Database is up to date.' : `Applied: ${applied.join(', ')}`,
    );
  } else if (command === 'down') {
    const rolledBack = await rollbackLastMigration(pool);
    console.log(rolledBack ? `Rolled back: ${rolledBack}` : 'No migrations to roll back.');
  } else {
    const applied = await listAppliedMigrations(pool);
    for (const migration of applied) {
      console.log(`${migration.id} — ${migration.name}`);
    }
  }
} finally {
  await pool.end();
}
