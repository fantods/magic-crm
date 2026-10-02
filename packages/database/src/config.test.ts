import { describe, expect, it } from 'vitest';
import { resolveDatabaseConfig } from './config.js';

describe('database configuration', () => {
  it('uses safe local defaults', () => {
    const config = resolveDatabaseConfig({});

    expect(config.connectionString).toBe('postgresql://formless:formless@127.0.0.1:5432/formless');
    expect(config.max).toBe(10);
    expect(config.applicationName).toBe('magic-crm');
  });

  it('reads explicit pool settings', () => {
    const config = resolveDatabaseConfig({
      DATABASE_URL: 'postgresql://user:pass@example.invalid:5432/db',
      DATABASE_POOL_MAX: '2',
      DATABASE_IDLE_TIMEOUT_MS: '1000',
      DATABASE_CONNECTION_TIMEOUT_MS: '2000',
    });

    expect(config.connectionString).toBe('postgresql://user:pass@example.invalid:5432/db');
    expect(config.max).toBe(2);
    expect(config.idleTimeoutMillis).toBe(1_000);
    expect(config.connectionTimeoutMillis).toBe(2_000);
  });

  it('rejects invalid pool sizes', () => {
    expect(() => resolveDatabaseConfig({ DATABASE_POOL_MAX: '0' })).toThrow(
      'DATABASE_POOL_MAX must be a positive integer',
    );
  });
});
