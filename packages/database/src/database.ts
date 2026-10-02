import pg, { type Pool, type PoolClient, type PoolConfig } from 'pg';
import { resolveDatabaseConfig, type DatabaseConfig } from './config.js';

export type DatabaseTransaction = <T>(callback: (client: PoolClient) => Promise<T>) => Promise<T>;

type FormlessPoolConfig = PoolConfig & {
  applicationName?: string;
};

export class FormlessDatabase {
  readonly pool: Pool;

  constructor(config: FormlessPoolConfig) {
    const { applicationName, ...poolConfig } = config;
    this.pool = new pg.Pool({
      ...poolConfig,
      application_name: applicationName ?? poolConfig.application_name,
    });
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): FormlessDatabase {
    return new FormlessDatabase(resolveDatabaseConfig(env));
  }

  static fromConfig(config: DatabaseConfig): FormlessDatabase {
    return new FormlessDatabase(config);
  }

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      try {
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
