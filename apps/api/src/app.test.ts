import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import {
  captureError,
  getErrorTelemetry,
  setErrorTelemetry,
  type ErrorTelemetryContext,
} from './observability/index.js';

describe('API health', () => {
  it('returns the validated health contract', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'ok',
        service: 'formless-api',
        version: '0.1.0',
      });
    } finally {
      await app.close();
    }
  });
});

describe('Ingestion API contract (network-free)', () => {
  it('rejects malformed ingestion bodies with the standard error shape', async () => {
    const app = await buildApp({ env: {} });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces/demo/ingestions',
        payload: { body: '' },
      });

      expect(response.statusCode).toBe(400);
      const payload = response.json();
      expect(payload.statusCode).toBe(400);
      expect(payload.error).toBe('Bad Request');
      expect(typeof payload.message).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('rejects invalid workspace ids before touching the pipeline', async () => {
    const app = await buildApp({ env: {} });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces/Not_A_Slug/ingestions',
        payload: { body: 'We operate three clinics.' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('Bad Request');
    } finally {
      await app.close();
    }
  });

  it('answers 503 when no model credentials are configured', async () => {
    const app = await buildApp({ env: {} });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces/demo/ingestions',
        payload: { body: 'We operate three clinics.' },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().message).toContain('OPENAI_API_KEY');
    } finally {
      await app.close();
    }
  });

  it('builds the real OpenAI adapter when a key is configured', async () => {
    // Construction must succeed without network; health never calls the model.
    const app = await buildApp({ env: { OPENAI_API_KEY: 'test-key' } });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('rejects invalid pagination query params', async () => {
    const app = await buildApp({ env: {} });

    try {
      const badLimit = await app.inject({
        method: 'GET',
        url: '/api/v1/workspaces/demo/schema/events?limit=0',
      });
      expect(badLimit.statusCode).toBe(400);

      const hugeLimit = await app.inject({
        method: 'GET',
        url: '/api/v1/workspaces/demo/schema/events?limit=1000',
      });
      expect(hugeLimit.statusCode).toBe(400);

      const badOffset = await app.inject({
        method: 'GET',
        url: '/api/v1/workspaces/demo/schema/events?offset=-1',
      });
      expect(badOffset.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('Production hardening (Milestone 8)', () => {
  it('sends security headers with sensible defaults', async () => {
    const app = await buildApp({ env: {} });

    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['referrer-policy']).toBeDefined();
      expect(response.headers['x-powered-by']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('keeps CORS explicit: only the configured origin is allowed', async () => {
    const app = await buildApp({
      env: {},
      corsOrigin: 'http://localhost:5173',
    });

    try {
      const allowed = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { origin: 'http://localhost:5173' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

      const denied = await app.inject({
        method: 'GET',
        url: '/api/v1/health',
        headers: { origin: 'http://evil.example' },
      });
      expect(denyHeader(denied.headers['access-control-allow-origin'])).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('rate-limits requests per IP with a documented override', async () => {
    const app = await buildApp({ env: {}, rateLimit: { max: 2, timeWindowMs: 60_000 } });

    try {
      const first = await app.inject({ method: 'GET', url: '/api/v1/health' });
      const second = await app.inject({ method: 'GET', url: '/api/v1/health' });
      const third = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(third.statusCode).toBe(429);
      expect(third.json().error).toBe('Too Many Requests');
      expect(third.headers['retry-after']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('respects RATE_LIMIT_ENABLED=false from the environment', async () => {
    const app = await buildApp({ env: { RATE_LIMIT_ENABLED: 'false' } });

    try {
      for (let request = 0; request < 5; request += 1) {
        const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
        expect(response.statusCode).toBe(200);
      }
    } finally {
      await app.close();
    }
  });

  it('emits structured JSON operational logs that never contain email bodies', async () => {
    const lines: string[] = [];
    const marker = 'TOPSECRET-BODY-MARKER';
    const app = await buildApp({ env: {}, logger: true, logSink: (line) => lines.push(line) });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces/demo/ingestions',
        headers: { authorization: 'Bearer sk-secret-key' },
        payload: { body: marker, subject: 12_345 },
      });
      expect(response.statusCode).toBe(400);

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const parsed: unknown = JSON.parse(line);
        expect(parsed).toBeTypeOf('object');
      }
      expect(lines.join('\n')).not.toContain(marker);
      expect(lines.join('\n')).not.toContain('sk-secret-key');
    } finally {
      await app.close();
    }
  });

  it('reports server failures through the telemetry hook and no-ops by default', async () => {
    // Default telemetry is a no-op that must never throw.
    expect(() => captureError(new Error('quiet'))).not.toThrow();

    const captured: Array<{
      message: string;
      context: ErrorTelemetryContext | undefined;
    }> = [];
    setErrorTelemetry({
      captureError: (error, context) => {
        captured.push({
          message: error instanceof Error ? error.message : String(error),
          context,
        });
      },
    });
    try {
      captureError(new Error('boom'), { route: '/x', statusCode: 500 });
      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        message: 'boom',
        context: { route: '/x', statusCode: 500 },
      });

      // A broken hook must never break request handling.
      expect(() =>
        setErrorTelemetry({
          captureError: () => {
            throw new Error('telemetry backend is down');
          },
        }),
      ).not.toThrow();
      expect(() => captureError(new Error('still fine'))).not.toThrow();

      // The current surface is the minimal hook contract.
      expect(typeof getErrorTelemetry().captureError).toBe('function');
    } finally {
      setErrorTelemetry(undefined);
    }
    expect(captured).toHaveLength(1);
  });
});

function denyHeader(value: unknown): boolean {
  return value !== 'http://evil.example';
}

describe('Query API contract (network-free)', () => {
  it('rejects malformed question bodies with the standard error shape', async () => {
    const app = await buildApp({ env: {} });

    try {
      const missing = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces/demo/query',
        payload: {},
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().statusCode).toBe(400);
      expect(missing.json().error).toBe('Bad Request');

      const blank = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces/demo/query',
        payload: { question: '   ' },
      });
      expect(blank.statusCode).toBe(400);

      const badSlug = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces/Not_A_Slug/query',
        payload: { question: 'Which leads have a budget over 5000?' },
      });
      expect(badSlug.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('answers 503 when no model credentials are configured', async () => {
    const app = await buildApp({ env: {} });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/workspaces/demo/query',
        payload: { question: 'Which leads have a budget over 5000?' },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().message).toContain('OPENAI_API_KEY');
    } finally {
      await app.close();
    }
  });
});
