import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';

// bigint (int8) -> number. All ids and toman prices are far below 2^53.
types.setTypeParser(20, (v) => Number.parseInt(v, 10));
// numeric -> number (rating averages)
types.setTypeParser(1700, (v) => Number.parseFloat(v));

export type Queryable = Pick<Pool | PoolClient, 'query'>;

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.pool = new Pool({ connectionString: cfg.databaseUrl, max: 10 });
    this.pool.on('error', (err) => this.logger.error(`pg pool error: ${err.message}`));
  }

  async query<T extends QueryResultRow = any>(text: string, params: unknown[] = [], q: Queryable = this.pool): Promise<T[]> {
    const res = await q.query<T>(text, params as any[]);
    return res.rows;
  }

  async one<T extends QueryResultRow = any>(text: string, params: unknown[] = [], q: Queryable = this.pool): Promise<T | null> {
    const rows = await this.query<T>(text, params, q);
    return rows[0] ?? null;
  }

  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
