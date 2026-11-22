import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

/** Minimal forward-only SQL migrator: migrations/NNNN_name.sql applied once, in order, each in a transaction. */
export async function migrate(pool: Pool, dir = join(__dirname, '..', '..', 'migrations')): Promise<string[]> {
  await pool.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const applied = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name as string));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      // advisory lock so two processes starting together do not both migrate
      await client.query('select pg_advisory_lock(727001)');
      const again = await client.query('select 1 from schema_migrations where name = $1', [file]);
      if (again.rowCount) continue;
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations(name) values ($1)', [file]);
      await client.query('commit');
      ran.push(file);
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    } finally {
      await client.query('select pg_advisory_unlock(727001)').catch(() => undefined);
      client.release();
    }
  }
  return ran;
}
