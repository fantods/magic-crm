import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  fetchHealth,
  fetchRecords,
  ingestEmail,
  isMissingKeyError,
  runQuery,
} from './client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API client', () => {
  it('parses a valid health response through the shared contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { status: 'ok', service: 'formless-api', version: '0.1.0' })),
    );

    const health = await fetchHealth();

    expect(health.service).toBe('formless-api');
  });

  it('maps a Fastify error body onto ApiError with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse(404, {
          statusCode: 404,
          error: 'Not Found',
          message: 'Workspace demo was not found',
        }),
      ),
    );

    await expect(fetchRecords('demo', 'table-1')).rejects.toMatchObject({
      status: 404,
      message: 'Workspace demo was not found',
    });
  });

  it('flags 503 answers as the missing-key demo state', async () => {
    const error = new ApiError(
      503,
      'Ingestion is unavailable: OPENAI_API_KEY is not configured on the server.',
    );

    expect(isMissingKeyError(error)).toBe(true);
    expect(isMissingKeyError(new ApiError(404, 'nope'))).toBe(false);
  });

  it('answers status 0 with a start-the-API hint when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    await expect(fetchHealth()).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ApiError && error.status === 0 && error.message.includes('unreachable'),
    );
  });

  it('rejects responses that violate the shared contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse(200, { status: 'ok', service: 'something-else' })),
    );

    await expect(fetchHealth()).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.message.includes('contract'),
    );
  });

  it('injects the workspace into ingestion payloads', async () => {
    const fetchMock = vi.fn(() => jsonResponse(201, {}));
    vi.stubGlobal('fetch', fetchMock);

    await ingestEmail('demo', { body: 'Hello from the demo' }).catch(() => undefined);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/workspaces/demo/ingestions');
    expect(JSON.parse(String(init.body))).toMatchObject({
      workspaceId: 'demo',
      body: 'Hello from the demo',
    });
  });

  it('sends query questions to the versioned query endpoint', async () => {
    const fetchMock = vi.fn(() => jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await runQuery('demo', { question: 'Which leads have a budget over 5000?' }).catch(
      () => undefined,
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/workspaces/demo/query');
    expect(JSON.parse(String(init.body))).toEqual({
      question: 'Which leads have a budget over 5000?',
    });
  });
});
