import { buildApp } from './app.js';
import { createFakeModelWiring } from './fake-models.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

/**
 * `MODEL_MODE` selects the models behind ingestion and query: `openai`
 * (default) uses the server-side OpenAI adapter and requires `OPENAI_API_KEY`;
 * `fake` runs the deterministic demo double, so containers and demos work
 * with no key and no network.
 */
const modelMode = (process.env.MODEL_MODE ?? 'openai').trim().toLowerCase();
if (modelMode !== 'openai' && modelMode !== 'fake') {
  throw new Error(`Invalid MODEL_MODE: ${process.env.MODEL_MODE}. Use "openai" or "fake".`);
}

const fakeWiring = modelMode === 'fake' ? createFakeModelWiring() : undefined;

const app = await buildApp({
  corsOrigin,
  logger: true,
  ...(fakeWiring === undefined
    ? {}
    : { models: fakeWiring.models, generateId: fakeWiring.generateId }),
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
