import cors from '@fastify/cors';
import {
  emailIngestionInputSchema,
  healthResponseSchema,
  ingestEmailResponseSchema,
  ingestionResponseSchema,
  schemaEventsResponseSchema,
  workspaceIdSchema,
  type HealthResponse,
  type IngestionResponse,
  type SchemaEventsResponse,
} from '@formless/contracts';
import { ReviewerRejectionError } from '@formless/core';
import {
  FormlessDatabase,
  IngestionRepository,
  SchemaEventRepository,
  WorkspaceRepository,
} from '@formless/database';
import { ModelCallFailure, OpenAiConfigError } from '@formless/openai';
import { ZodError, type ZodType } from 'zod';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  IngestionService,
  InvalidEmailError,
  SchemaConflictError,
  type IngestEmailOutcome,
} from './ingestion-service.js';
import { createOpenAiModels, type IngestionModels } from './models.js';

const packageVersion = '0.1.0';

export interface BuildAppOptions {
  corsOrigin?: string;
  logger?: boolean;
  /** Database override; defaults to `FormlessDatabase.fromEnv()`. */
  database?: FormlessDatabase;
  /** Model override; defaults to the OpenAI adapter when `OPENAI_API_KEY` is set. */
  models?: IngestionModels;
  /** Environment used for model configuration resolution; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** ID generator override for deterministic tests; defaults to random UUIDs. */
  generateId?: () => string;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function parseOr400<T>(schema: ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new HttpError(400, error.issues.map((issue) => issue.message).join('; '));
    }
    throw error;
  }
}

function requireWorkspaceId(request: FastifyRequest): string {
  const { workspaceId } = request.params as { workspaceId: string };
  return parseOr400(workspaceIdSchema, workspaceId);
}

function requireWorkspace(
  workspaces: WorkspaceRepository,
  executor: Pick<FormlessDatabase['pool'], 'query'>,
  workspaceId: string,
): Promise<unknown> {
  return workspaces.get(executor, workspaceId).then((workspace) => {
    if (!workspace) {
      throw new HttpError(404, `Workspace ${workspaceId} was not found`);
    }
    return workspace;
  });
}

/**
 * Maps ingestion pipeline failures onto the API error contract. Fastify's
 * default serializer turns the thrown `statusCode`-carrying errors into the
 * same `{ statusCode, error, message }` JSON the other endpoints produce.
 */
export function mapIngestionError(error: unknown): never {
  if (error instanceof InvalidEmailError) {
    throw new HttpError(400, error.message);
  }
  if (error instanceof ReviewerRejectionError) {
    throw new HttpError(422, `Reviewer rejected the email: ${error.decision.table.rationale}`);
  }
  if (error instanceof OpenAiConfigError) {
    throw new HttpError(503, 'Ingestion is unavailable: OpenAI is not configured on the server.');
  }
  if (error instanceof ModelCallFailure) {
    throw new HttpError(502, `Model call failed: ${error.message}`);
  }
  if (error instanceof SchemaConflictError) {
    throw new HttpError(409, error.message);
  }
  if (error instanceof ZodError) {
    // Contract violations from model output or stored state, not client input.
    throw new HttpError(502, 'Model output did not satisfy the ingestion contract.');
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  ) {
    throw new HttpError(409, 'Concurrent ingestion created the same schema element.');
  }
  throw error;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePaginationValue(name: 'limit' | 'offset', value: unknown, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new HttpError(400, `Query parameter ${name} must be a non-negative integer`);
  }
  if (name === 'limit' && (parsed < 1 || parsed > 200)) {
    throw new HttpError(400, 'Query parameter limit must be between 1 and 200');
  }
  return parsed;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  await app.register(cors, {
    origin: options.corsOrigin ?? 'http://localhost:5173',
  });

  const database = options.database ?? FormlessDatabase.fromEnv();
  const workspaces = new WorkspaceRepository();
  const ingestionsRepository = new IngestionRepository();
  const schemaEventsRepository = new SchemaEventRepository();
  let models: IngestionModels | undefined = options.models;
  if (models === undefined) {
    try {
      models = createOpenAiModels(options.env ?? process.env);
    } catch (error) {
      if (!(error instanceof OpenAiConfigError)) {
        throw error;
      }
      models = undefined;
    }
  }
  const ingestionService =
    models === undefined
      ? undefined
      : new IngestionService({
          database,
          architect: models.architect,
          reviewer: models.reviewer,
          modelLabel: models.label,
          ...(options.generateId === undefined ? {} : { generateId: options.generateId }),
        });

  app.get('/api/v1/health', async (): Promise<HealthResponse> => {
    const response: HealthResponse = {
      status: 'ok',
      service: 'formless-api',
      version: packageVersion,
    };

    return healthResponseSchema.parse(response);
  });

  app.post('/api/v1/workspaces/:workspaceId/ingestions', async (request, reply) => {
    const workspaceId = requireWorkspaceId(request);
    const body = parseOr400(emailIngestionInputSchema.omit({ workspaceId: true }), request.body);

    if (ingestionService === undefined) {
      throw new HttpError(
        503,
        'Ingestion is unavailable: OPENAI_API_KEY is not configured on the server.',
      );
    }

    let outcome: IngestEmailOutcome;
    try {
      outcome = await ingestionService.ingestEmail({ ...body, workspaceId });
    } catch (error) {
      await ingestionService.recordFailure({ ...body, workspaceId }, describeError(error));
      mapIngestionError(error);
    }

    const response = ingestEmailResponseSchema.parse(outcome.response);
    reply.code(outcome.replayed ? 200 : 201);
    return response;
  });

  app.get('/api/v1/workspaces/:workspaceId/ingestions/:ingestionId', async (request) => {
    const workspaceId = requireWorkspaceId(request);
    const { ingestionId } = request.params as { ingestionId: string };

    const ingestion = await database.withTransaction(async (client) => {
      await requireWorkspace(workspaces, client, workspaceId);
      const found = await ingestionsRepository.getInWorkspace(client, workspaceId, ingestionId);
      if (!found) {
        throw new HttpError(404, `Ingestion ${ingestionId} was not found`);
      }
      return found;
    });

    const response: IngestionResponse = { ingestion };
    return ingestionResponseSchema.parse(response);
  });

  app.get('/api/v1/workspaces/:workspaceId/schema/events', async (request) => {
    const workspaceId = requireWorkspaceId(request);
    const query = (request.query ?? {}) as { limit?: unknown; offset?: unknown };
    const limit = parsePaginationValue('limit', query.limit, 50);
    const offset = parsePaginationValue('offset', query.offset, 0);

    const page = await database.withTransaction(async (client) => {
      await requireWorkspace(workspaces, client, workspaceId);
      return schemaEventsRepository.listPage(client, workspaceId, { limit, offset });
    });

    const response: SchemaEventsResponse = { events: page.events, total: page.total };
    return schemaEventsResponseSchema.parse(response);
  });

  return app;
}
