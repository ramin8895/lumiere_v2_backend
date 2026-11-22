export interface AppConfig {
  port: number;
  bindHost: string;
  databaseUrl: string;
  autoMigrate: boolean;
  siteName: string;
  siteUrl: string;
  utmSource: string;
  feedUrl: string;
  secret: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  minShopProducts: number;
  hashSalt: string;
}

const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));
const int = (v: string | undefined, d: number) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const cfg: AppConfig = {
    port: int(env.PORT, 4100),
    bindHost: env.BIND_HOST || '127.0.0.1',
    databaseUrl: env.DATABASE_URL || '',
    autoMigrate: bool(env.AUTO_MIGRATE, true),
    siteName: env.SITE_NAME || 'Lumiere',
    siteUrl: (env.SITE_URL || 'http://localhost:3003').replace(/\/$/, ''),
    utmSource: env.UTM_SOURCE || 'lumiere',
    feedUrl: (env.NEXCART_FEED_URL || 'http://127.0.0.1:4000/api/lumiere/sync').replace(/\/$/, ''),
    secret: env.LUMIERE_SYNC_SECRET || '',
    syncEnabled: bool(env.SYNC_ENABLED, true),
    syncIntervalMinutes: Math.max(1, int(env.SYNC_INTERVAL_MINUTES, 15)),
    minShopProducts: Math.max(0, int(env.MIN_SHOP_PRODUCTS, 3)),
    hashSalt: env.HASH_SALT || '',
  };
  return cfg;
}

/** Fail fast on a misconfigured production start (called from main.ts, not from tests). */
export function assertProductionConfig(cfg: AppConfig): void {
  const problems: string[] = [];
  if (!cfg.databaseUrl) problems.push('DATABASE_URL is required');
  if (cfg.secret.length < 24) problems.push('LUMIERE_SYNC_SECRET must be at least 24 characters');
  if (!cfg.hashSalt) problems.push('HASH_SALT is required');
  if (problems.length) throw new Error(`Invalid configuration: ${problems.join('; ')}`);
}

export const APP_CONFIG = 'APP_CONFIG';
