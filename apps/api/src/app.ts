import cors from '@fastify/cors';
import { healthResponseSchema, type HealthResponse } from '@formless/contracts';
import Fastify from 'fastify';

const packageVersion = '0.1.0';

export interface BuildAppOptions {
  corsOrigin?: string;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  await app.register(cors, {
    origin: options.corsOrigin ?? 'http://localhost:5173',
  });

  app.get('/api/v1/health', async (): Promise<HealthResponse> => {
    const response: HealthResponse = {
      status: 'ok',
      service: 'formless-api',
      version: packageVersion,
    };

    return healthResponseSchema.parse(response);
  });

  return app;
}
