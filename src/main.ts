import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { assertProductionConfig, loadConfig } from './config/app-config';
import { migrate } from './db/migrator';

async function main() {
  const cfg = loadConfig();
  assertProductionConfig(cfg);
  if (cfg.autoMigrate) {
    const pool = new Pool({ connectionString: cfg.databaseUrl });
    const ran = await migrate(pool);
    await pool.end();
    if (ran.length) new Logger('migrate').log(`applied ${ran.join(', ')}`);
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  configureApp(app);
  app.set('trust proxy', 'loopback');
  app.enableShutdownHooks();
  await app.listen(cfg.port, cfg.bindHost);
  new Logger('lumiere-api').log(`listening on ${cfg.bindHost}:${cfg.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
