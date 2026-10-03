import {
  emailIngestionInputSchema,
  healthResponseSchema,
  ingestEmailResponseSchema,
  naturalLanguageQueryInputSchema,
  queryResponseSchema,
  recordsResponseSchema,
  schemaCatalogResponseSchema,
  schemaEventsResponseSchema,
  type EmailIngestionInput,
  type HealthResponse,
  type IngestEmailResponse,
  type NaturalLanguageQueryInput,
  type QueryResponse,
  type RecordsResponse,
  type SchemaCatalogResponse,
  type SchemaEventsResponse,
} from '@formless/contracts';
import { z, type ZodType } from 'zod';

/**
 * Browser-side API client for the versioned `/api/v1` endpoints.
 *
 * Every response is validated against the shared Zod contracts before it
 * reaches React state, and errors are normalized to {@link ApiError} so the
 * UI can react to status codes (for example the 503 that tells the demo the
 * server has no `OPENAI_API_KEY`). The browser never sees any model key.
 */

const apiErrorBodySchema = z.object({
  message: z.string().min(1).optional(),
});

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** True when the server answered 503 because no OpenAI key is configured. */
export function isMissingKeyError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 503;
}

export const apiBaseUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1').replace(
  /\/+$/,
  '',
);

async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(
      0,
      `The API at ${apiBaseUrl} is unreachable. Start it in another terminal with "pnpm dev:api".`,
    );
  }

  const text = await response.text();
  let body: unknown;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = undefined;
    }
  }

  if (!response.ok) {
    const detail = apiErrorBodySchema.safeParse(body);
    const message = detail.success ? detail.data.message : undefined;
    throw new ApiError(
      response.status,
      message ?? `Request failed with status ${response.status}.`,
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(
      response.status,
      'The API response did not match the shared contract. Update the server and reload.',
    );
  }
  return result.data;
}

export function fetchHealth(): Promise<HealthResponse> {
  return request('/health', healthResponseSchema);
}

export function fetchSchemaCatalog(workspaceId: string): Promise<SchemaCatalogResponse> {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/schema`,
    schemaCatalogResponseSchema,
  );
}

export function fetchSchemaEvents(workspaceId: string): Promise<SchemaEventsResponse> {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/schema/events?limit=200`,
    schemaEventsResponseSchema,
  );
}

export function fetchRecords(workspaceId: string, tableId: string): Promise<RecordsResponse> {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/tables/${encodeURIComponent(tableId)}/records`,
    recordsResponseSchema,
  );
}

export type IngestEmailRequest = Omit<EmailIngestionInput, 'workspaceId'>;

export function ingestEmail(
  workspaceId: string,
  input: IngestEmailRequest,
): Promise<IngestEmailResponse> {
  const payload = emailIngestionInputSchema.parse({ ...input, workspaceId });
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/ingestions`,
    ingestEmailResponseSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export function runQuery(
  workspaceId: string,
  input: NaturalLanguageQueryInput,
): Promise<QueryResponse> {
  const payload = naturalLanguageQueryInputSchema.parse(input);
  return request(`/workspaces/${encodeURIComponent(workspaceId)}/query`, queryResponseSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
