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
