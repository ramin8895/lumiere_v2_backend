import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { signRequest } from '../src/common/hmac';
import { migrate } from '../src/db/migrator';
import { SECRET } from './mock-feed';

export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgresql://lumiere:lumiere@127.0.0.1:55432/lumiere_test';

export async function resetDb() {
  const pool = new Pool({ connectionString: TEST_DB });
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool);
  await pool.end();
}

export async function createApp(feedUrl: string, extraEnv: Record<string, string> = {}): Promise<INestApplication> {
  Object.assign(process.env, {
    DATABASE_URL: TEST_DB, NEXCART_FEED_URL: feedUrl, LUMIERE_SYNC_SECRET: SECRET, SYNC_ENABLED: 'false',
    HASH_SALT: 'salt', MIN_SHOP_PRODUCTS: '3', UTM_SOURCE: 'lumiere', ...extraEnv,
  });
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** supertest request signed the way nexcart-api signs admin calls */
export function signed(app: INestApplication, method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  const ts = String(Date.now());
  return request(app.getHttpServer())[method](path)
    .set('x-lumiere-timestamp', ts)
    .set('x-lumiere-signature', signRequest(SECRET, ts, method, path));
}
