import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DbService } from '../db/db.service';
import { EligibilityRepository } from '../eligibility/eligibility.repository';
import { FeedClient } from '../feed/feed.client';
import { ListingsRepository } from '../catalog/listings.repository';
import { ShopRow, ShopsRepository } from '../shops/shops.repository';
import { mapFeedProduct } from './feed-mapper';

export interface SyncResult {
  shopId: number;
  full: boolean;
  pages: number;
  created: number;
  updated: number;
  deleted: number;
  error?: string;
}

const MAX_PAGES = 2000;
const OVERLAP_MS = 2 * 60 * 1000;
const FULL_EVERY_MS = 60 * 60 * 1000;

@Injectable()
export class SyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SyncService.name);
  private readonly running = new Set<number>();
  private timer?: NodeJS.Timeout;
  private allRunning = false;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly db: DbService,
    private readonly feed: FeedClient,
    private readonly shops: ShopsRepository,
    private readonly listings: ListingsRepository,
    private readonly eligibility: EligibilityRepository,
  ) {}

  onApplicationBootstrap() {
    if (!this.cfg.syncEnabled) return;
    const ms = this.cfg.syncIntervalMinutes * 60_000;
    // first run shortly after boot, then on the interval; never overlaps itself
    setTimeout(() => void this.syncAll(), 10_000).unref();
    this.timer = setInterval(() => void this.syncAll(), ms);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Pull the merchant list. An empty answer never switches existing shops off (could be an outage or a bug). */
  async refreshMerchants(): Promise<{ upserted: number; deactivated: number }> {
    const merchants = await this.feed.merchants();
    const existing = await this.db.one<{ n: number }>("select count(*)::int as n from shop where source = 'NEXCART'");
    if (merchants.length === 0 && (existing?.n ?? 0) > 0) {
      throw new Error('feed returned zero merchants while shops exist; refusing to deactivate everything');
    }
    for (const m of merchants) await this.shops.upsertFromMerchant(m);
    const deactivated = await this.shops.deactivateMissing(merchants.map((m) => m.tenantId));
    await this.eligibility.recompute();
    return { upserted: merchants.length, deactivated };
  }

  /** Incremental pass for every syncable shop (a full reconcile when the last one is older than an hour). */
  async syncAll(opts: { full?: boolean } = {}): Promise<SyncResult[]> {
    if (this.allRunning) return [];
    this.allRunning = true;
    const results: SyncResult[] = [];
    try {
      await this.refreshMerchants();
      for (const shop of await this.shops.syncable()) {
        const due = !shop.last_full_sync_at || Date.now() - shop.last_full_sync_at.getTime() > FULL_EVERY_MS;
        results.push(await this.syncShop(shop.id, { full: opts.full || due }));
      }
    } catch (e) {
      this.logger.error(`syncAll failed: ${(e as Error).message}`);
    } finally {
      this.allRunning = false;
    }
    return results;
  }

  async syncShop(shopId: number, opts: { full?: boolean } = {}): Promise<SyncResult> {
    const result: SyncResult = { shopId, full: !!opts.full, pages: 0, created: 0, updated: 0, deleted: 0 };
    if (this.running.has(shopId)) return { ...result, error: 'already running' };
    this.running.add(shopId);
    const startedAt = new Date();
    try {
      const shop = await this.shops.byId(shopId);
      if (!shop) throw new Error('shop not found');
      if (!shop.sync_enabled || !shop.tenant_active) {
        await this.eligibility.recompute(shopId);
        return result;
      }
      const full = !!opts.full || !shop.last_sync_at;
      result.full = full;
      const since = full ? undefined : new Date(shop.last_sync_at!.getTime() - OVERLAP_MS).toISOString();

      let cursor: string | undefined;
      for (;;) {
        if (++result.pages > MAX_PAGES) throw new Error('too many pages');
        const page = await this.feed.products({ tenantId: shop.source_id, since, cursor });
        await this.applyPage(shop, page.items, startedAt, result);
        if (!page.nextCursor) break;
        if (page.nextCursor === cursor) throw new Error('feed cursor did not advance');
        cursor = page.nextCursor;
      }
      if (full) result.deleted = await this.listings.markUnseenDeleted(shopId, startedAt);
      await this.eligibility.recompute(shopId);
      await this.shops.markSyncOk(shopId, startedAt, full);
    } catch (e) {
      result.error = (e as Error).message;
      this.logger.warn(`sync shop ${shopId} failed: ${result.error}`);
      await this.shops.markSyncFailed(shopId, result.error).catch(() => undefined);
    } finally {
      this.running.delete(shopId);
    }
    return result;
  }

  private async applyPage(shop: ShopRow, items: Parameters<typeof mapFeedProduct>[0][], runStart: Date, result: SyncResult) {
    await this.db.tx(async (c) => {
      for (const item of items) {
        if (!item?.id || !item.slug || !item.title) continue; // malformed row: skip, never abort the page
        const m = mapFeedProduct(item, shop.excluded_category_ids);
        let scId: number | null = null;
        let catId: number | null = null;
        if (m.sourceCategoryKey) {
          scId = await this.listings.upsertSourceCategory(c, shop.id, m.sourceCategoryKey, m.sourceCategoryName ?? m.sourceCategoryKey, m.sourceCategoryPath ?? m.sourceCategoryKey);
          catId = await this.listings.categoryForSource(c, scId);
        }
        const r = await this.listings.upsert(c, shop.id, m, scId, catId, runStart);
        if (r === 'created') result.created++;
        else result.updated++;
      }
    });
  }
}
