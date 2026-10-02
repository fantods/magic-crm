export interface DatabaseConfig {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  applicationName: string;
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  fieldName: string,
): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${fieldName} must be a positive integer`);
  }

  return parsed;
}

export function resolveDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  return {
    connectionString: env.DATABASE_URL ?? 'postgresql://formless:formless@127.0.0.1:5432/formless',
    max: readPositiveInteger(env.DATABASE_POOL_MAX, 10, 'DATABASE_POOL_MAX'),
    idleTimeoutMillis: readPositiveInteger(
      env.DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      'DATABASE_IDLE_TIMEOUT_MS',
    ),
    connectionTimeoutMillis: readPositiveInteger(
      env.DATABASE_CONNECTION_TIMEOUT_MS,
      5_000,
      'DATABASE_CONNECTION_TIMEOUT_MS',
    ),
    applicationName: 'magic-crm',
  };
}
