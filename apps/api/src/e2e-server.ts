import { FormlessDatabase, runMigrations } from '@formless/database';
import process from 'node:process';
import { buildApp } from './app.js';
import { createFakeModelWiring } from './fake-models.js';

/**
 * HTTP API server for the Playwright end-to-end demo run.
 *
 * This is test tooling, not a product entry point: it serves the exact same
 * `buildApp` API wired to the deterministic fake models from
 * `@formless/testing` (via the shared `MODEL_MODE=fake` wiring), so the
 * browser walkthrough needs no OpenAI key and no network. It targets a
 * dedicated `*e2e*` database, which it resets on every boot so the demo
 * always starts from a clean, deterministic state.
 */

const port = Number(process.env.PORT ?? 3005);
const host = process.env.HOST ?? '127.0.0.1';
const databaseUrl =
  process.env.E2E_DATABASE_URL ?? 'postgresql://formless:formless@127.0.0.1:5432/formless_e2e';
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://127.0.0.1:5175';

const databaseName = new URL(databaseUrl).pathname.replaceAll('/', '');
if (!/e2e/i.test(databaseName)) {
  throw new Error(
    `Refusing to boot the e2e server against non-e2e database "${databaseName}": the server resets its database on start. Set E2E_DATABASE_URL to a dedicated e2e database.`,
  );
}

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const { models, generateId } = createFakeModelWiring({ label: 'fake:e2e' });

// Create the dedicated e2e database if it does not exist yet, then reset it
// so every walkthrough starts clean.
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = '/postgres';
const admin = new FormlessDatabase({
  connectionString: adminUrl.toString(),
  max: 2,
  applicationName: 'magic-crm-e2e-admin',
});
const existing = await admin.pool.query<{ datname: string }>(
  'SELECT datname FROM pg_database WHERE datname = $1',
  [databaseName],
);
if (existing.rows.length === 0) {
  await admin.pool.query(`CREATE DATABASE ${databaseName}`);
  console.log(`Created e2e database ${databaseName}`);
}
await admin.close();

const bootstrap = new FormlessDatabase({
  connectionString: databaseUrl,
  max: 2,
  applicationName: 'magic-crm-e2e-bootstrap',
});
await bootstrap.withTransaction(async (client) => {
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
});
await bootstrap.close();

const database = new FormlessDatabase({
  connectionString: databaseUrl,
  max: 10,
  applicationName: 'magic-crm-e2e',
});
await runMigrations(database.pool);

const app = await buildApp({
  database,
  models,
  generateId,
  corsOrigin,
  logger: true,
  // The walkthrough makes more requests than the default per-IP budget while
  // polling; the e2e server has no untrusted callers.
  rateLimit: { enabled: false },
});

// The demo UI ingests the example emails by pasting their text, which derives
// content-hash idempotency keys; a seeded first run is therefore unnecessary.
process.on('SIGTERM', () => {
  void app.close().then(() => database.close());
});
process.on('SIGINT', () => {
  void app.close().then(() => database.close());
});

try {
  await app.listen({ port, host });
  console.log(`e2e API (fake models) listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
  await database.close();
}
