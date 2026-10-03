import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  emailIngestionInputSchema,
  healthResponseSchema,
  ingestEmailResponseSchema,
  ingestionResponseSchema,
  naturalLanguageQueryInputSchema,
  queryResponseSchema,
  recordsResponseSchema,
  schemaCatalogResponseSchema,
  schemaEventsResponseSchema,
  workspaceIdSchema,
  type HealthResponse,
  type IngestionResponse,
  type QueryResponse,
  type RecordsResponse,
  type SchemaCatalogResponse,
  type SchemaEventsResponse,
} from '@formless/contracts';
import { ReviewerRejectionError } from '@formless/core';
import {
  FormlessDatabase,
  IngestionRepository,
  RecordRepository,
  SchemaCatalogRepository,
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
import { createOpenAiModels, type ApiModels } from './models.js';
import {
  QueryPlanError,
  QueryService,
  QueryTableNotFoundError,
  QueryWorkspaceNotFoundError,
} from './query-service.js';
import { captureError, OperationalLogger, silentLogger } from './observability/index.js';
import { registerMetrics } from './observability/metrics.js';

const packageVersion = '0.1.0';

export interface BuildAppOptions {
  corsOrigin?: string;
  logger?: boolean;
  /** Database override; defaults to `FormlessDatabase.fromEnv()`. */
  database?: FormlessDatabase;
  /** Model override; defaults to the OpenAI adapter when `OPENAI_API_KEY` is set. */
  models?: ApiModels;
  /** Environment used for model configuration resolution; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** ID generator override for deterministic tests; defaults to random UUIDs. */
  generateId?: () => string;
  /**
   * Rate-limit override for tests; defaults resolve from `RATE_LIMIT_*` env
   * vars with a conservative per-IP default.
   */
  rateLimit?: RateLimitOptions;
  /**
   * Sink for structured operational log lines (one JSON object per line);
   * defaults to `console.log`. Only used when `logger` is enabled.
   */
  logSink?: (line: string) => void;
}

/**
 * Per-IP rate limiting for the API. Enabled by default with a conservative
 * limit; operators override via `RATE_LIMIT_MAX`, `RATE_LIMIT_TIME_WINDOW_MS`,
 * and `RATE_LIMIT_ENABLED` environment variables.
 */
export interface RateLimitOptions {
  readonly enabled?: boolean;
  /** Maximum requests per IP inside the time window. */
  readonly max?: number;
  /** Time window in milliseconds. */
  readonly timeWindowMs?: number;
}

function parsePositiveIntegerEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function resolveRateLimitOptions(
  override: RateLimitOptions | undefined,
  env: Record<string, string | undefined>,
): { enabled: boolean; max: number; timeWindowMs: number } {
  const enabledRaw = env.RATE_LIMIT_ENABLED?.trim().toLowerCase();
  const enabled =
    override?.enabled ??
    (enabledRaw === undefined || enabledRaw === ''
      ? true
      : enabledRaw !== 'false' && enabledRaw !== '0');
  return {
    enabled,
    max: override?.max ?? parsePositiveIntegerEnv(env, 'RATE_LIMIT_MAX', 300),
    timeWindowMs:
      override?.timeWindowMs ?? parsePositiveIntegerEnv(env, 'RATE_LIMIT_TIME_WINDOW_MS', 60_000),
  };
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

/**
 * Maps query pipeline failures onto the API error contract, mirroring
 * {@link mapIngestionError}. Client-input violations answer 400/404;
 * planner-output violations answer 502 because they are server-side model
 * failures, never malformed client requests.
 */
export function mapQueryError(error: unknown): never {
  if (error instanceof QueryWorkspaceNotFoundError || error instanceof QueryTableNotFoundError) {
    throw new HttpError(404, error.message);
  }
  if (error instanceof QueryPlanError) {
    throw new HttpError(502, `Model output did not satisfy the query contract: ${error.message}`);
  }
  if (error instanceof OpenAiConfigError) {
    throw new HttpError(503, 'Query is unavailable: OpenAI is not configured on the server.');
  }
  if (error instanceof ModelCallFailure) {
    throw new HttpError(502, `Model call failed: ${error.message}`);
  }
  if (error instanceof ZodError) {
    // Contract violations from model output or stored state, not client input.
    throw new HttpError(502, 'Model output did not satisfy the query contract.');
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
  const env = options.env ?? process.env;
  const app = Fastify({
    logger: options.logger
      ? {
          level: 'info',
          // Defense in depth for the plan's privacy decision: request bodies
          // and credentials never reach the log, even if a serializer changes.
          redact: ['req.body', 'req.headers.authorization', 'req.headers.cookie'],
          ...(options.logSink === undefined ? {} : { stream: { write: options.logSink } }),
        }
      : false,
  });
  const operational = options.logger
    ? new OperationalLogger(options.logSink === undefined ? {} : { writeLine: options.logSink })
    : silentLogger;

  // Security headers with sensible defaults; the API serves JSON only, so the
  // helmet defaults (no frame ancestry, nosniff, restrictive CSP) all apply.
  await app.register(helmet);

  await app.register(cors, {
    origin: options.corsOrigin ?? 'http://localhost:5173',
  });

  const rateLimitOptions = resolveRateLimitOptions(options.rateLimit, env);
  if (rateLimitOptions.enabled) {
    await app.register(rateLimit, {
      max: rateLimitOptions.max,
      timeWindow: rateLimitOptions.timeWindowMs,
    });
  }

  // Prometheus metrics (HTTP request metrics + Node.js process metrics) on
  // `/api/v1/metrics`. Registered before the routes so the plugin's onRoute
  // hook whitelists every endpoint. Route labels are templates, so no email
  // content can reach a metric.
  await registerMetrics(app);

  // Server-side error telemetry hook: no-op by default, operator-wireable.
  // Only server failures are reported; client mistakes are not errors.
  app.addHook('onError', async (request, reply, error) => {
    if (reply.statusCode >= 500) {
      operational.error('request_error', {
        method: request.method,
        url: request.url,
        status_code: reply.statusCode,
        error_name: error instanceof Error ? error.name : 'Unknown',
      });
      captureError(error, {
        route: request.url,
        method: request.method,
        statusCode: reply.statusCode,
      });
    }
  });

  const database = options.database ?? FormlessDatabase.fromEnv(env);
  const workspaces = new WorkspaceRepository();
  const ingestionsRepository = new IngestionRepository();
  const schemaEventsRepository = new SchemaEventRepository();
  const schemaCatalogRepository = new SchemaCatalogRepository();
  const recordRepository = new RecordRepository();
  let models: ApiModels | undefined = options.models;
  if (models === undefined) {
    try {
      models = createOpenAiModels(env, (metadata) => operational.modelCall(metadata));
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
  const queryService =
    models === undefined ? undefined : new QueryService({ database, planner: models.planner });

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
      captureError(error, {
        route: 'POST /api/v1/workspaces/:workspaceId/ingestions',
        workspaceId,
      });
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

  app.get('/api/v1/workspaces/:workspaceId/schema', async (request) => {
    const workspaceId = requireWorkspaceId(request);

    const response: SchemaCatalogResponse = await database.withTransaction(async (client) => {
      await requireWorkspace(workspaces, client, workspaceId);
      const [schema, revision] = await Promise.all([
        schemaCatalogRepository.getSchema(client, workspaceId),
        schemaEventsRepository.currentRevision(client, workspaceId),
      ]);
      return {
        workspaceId,
        revision,
        tables: schema.tables.map(({ table, columns }) => ({ table, columns: [...columns] })),
      };
    });

    return schemaCatalogResponseSchema.parse(response);
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

  app.get('/api/v1/workspaces/:workspaceId/tables/:tableId/records', async (request) => {
    const workspaceId = requireWorkspaceId(request);
    const { tableId } = request.params as { tableId: string };
    const query = (request.query ?? {}) as { limit?: unknown };
    const limit = parsePaginationValue('limit', query.limit, 200);

    const records = await database.withTransaction(async (client) => {
      await requireWorkspace(workspaces, client, workspaceId);
      const table = await schemaCatalogRepository.getTable(client, workspaceId, tableId);
      if (!table) {
        throw new HttpError(404, `Record table ${tableId} was not found`);
      }
      return recordRepository.listByTable(client, workspaceId, tableId, limit);
    });

    const response: RecordsResponse = { records };
    return recordsResponseSchema.parse(response);
  });

  app.post('/api/v1/workspaces/:workspaceId/query', async (request) => {
    const workspaceId = requireWorkspaceId(request);
    const body = parseOr400(naturalLanguageQueryInputSchema, request.body);

    if (queryService === undefined) {
      throw new HttpError(
        503,
        'Query is unavailable: OPENAI_API_KEY is not configured on the server.',
      );
    }

    let response: QueryResponse;
    try {
      response = await queryService.runQuery({
        workspaceId,
        question: body.question,
        ...(body.tableId === undefined ? {} : { tableId: body.tableId }),
      });
    } catch (error) {
      captureError(error, {
        route: 'POST /api/v1/workspaces/:workspaceId/query',
        workspaceId,
      });
      mapQueryError(error);
    }

    return queryResponseSchema.parse(response);
  });

  return app;
}
