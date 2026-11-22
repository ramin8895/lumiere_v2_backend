import { Pool } from 'pg';
import { loadConfig } from '../config/app-config';
import { migrate } from './migrator';

(async () => {
  const cfg = loadConfig();
  if (!cfg.databaseUrl) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: cfg.databaseUrl });
  const ran = await migrate(pool);
  console.log(ran.length ? `applied: ${ran.join(', ')}` : 'up to date');
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
