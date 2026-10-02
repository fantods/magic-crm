import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

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
