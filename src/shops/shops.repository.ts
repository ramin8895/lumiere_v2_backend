import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';
import { shopSlug } from '../common/slug';
import { FeedMerchant } from '../feed/feed.types';

export interface ShopRow {
  id: number;
  source: string;
  source_id: string;
  name: string;
  slug: string;
  store_url: string;
  logo_url: string | null;
  description: string | null;
  city: string | null;
  phone: string | null;
  show_phone: boolean;
  shipping_hours: number | null;
  free_shipping_above: number | null;
  rating_avg: number;
  rating_count: number;
  excluded_category_ids: string[];
  sync_enabled: boolean;
  tenant_active: boolean;
  subscription_active: boolean;
  blocked_by_admin: boolean;
  displayable_count: number;
  eligible: boolean;
  first_eligible_at: Date | null;
  reviewed_at: Date | null;
  last_sync_at: Date | null;
  last_full_sync_at: Date | null;
  last_sync_error: string | null;
  last_sync_error_at: Date | null;
}

@Injectable()
export class ShopsRepository {
  constructor(private readonly db: DbService) {}

  byId(id: number, q?: Queryable) {
    return this.db.one<ShopRow>('select * from shop where id = $1', [id], q);
  }
  bySourceId(sourceId: string, source = 'NEXCART') {
    return this.db.one<ShopRow>('select * from shop where source = $1 and source_id = $2', [source, sourceId]);
  }
  bySlug(slug: string) {
    return this.db.one<ShopRow>('select * from shop where slug = $1', [slug]);
  }
  syncable() {
    return this.db.query<ShopRow>('select * from shop where sync_enabled and tenant_active order by id');
  }

  /** Insert or update a shop from a feed merchant. Slug is stable after the first insert. */
  async upsertFromMerchant(m: FeedMerchant): Promise<ShopRow> {
    const showPhone = m.showPhone ?? true;
    const params = [
      m.tenantId, m.name, m.storeUrl, m.logoUrl ?? null, m.description ?? null, m.city ?? null,
      showPhone ? (m.phone ?? null) : null, showPhone, m.shippingHours ?? null, m.freeShippingAbove ?? null,
      m.ratingAvg ?? 0, m.ratingCount ?? 0, m.excludedCategoryIds ?? [], !!m.syncEnabled, !!m.isActive,
      m.subscriptionActive ?? true,
    ];
    const sql = (slugParam: string) => `
      insert into shop (source, source_id, name, store_url, logo_url, description, city, phone, show_phone, shipping_hours,
                        free_shipping_above, rating_avg, rating_count, excluded_category_ids, sync_enabled, tenant_active,
                        subscription_active, slug)
      values ('NEXCART', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, ${slugParam})
      on conflict (source, source_id) do update set
        name = excluded.name, store_url = excluded.store_url, logo_url = excluded.logo_url, description = excluded.description,
        city = excluded.city, phone = excluded.phone, show_phone = excluded.show_phone, shipping_hours = excluded.shipping_hours,
        free_shipping_above = excluded.free_shipping_above, rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
        excluded_category_ids = excluded.excluded_category_ids, sync_enabled = excluded.sync_enabled,
        tenant_active = excluded.tenant_active, subscription_active = excluded.subscription_active, updated_at = now()
      returning *`;
    const base = shopSlug(m.subdomain, m.tenantId);
    try {
      return (await this.db.one<ShopRow>(sql('$17'), [...params, base]))!;
    } catch (e: any) {
      if (e?.code === '23505' && String(e.constraint).includes('slug')) {
        return (await this.db.one<ShopRow>(sql('$17'), [...params, `${base}-${m.tenantId.slice(-6).toLowerCase()}`]))!;
      }
      throw e;
    }
  }

  /** Shops that disappeared from the feed are switched off (never deleted: history and clicks stay). */
  async deactivateMissing(presentSourceIds: string[]): Promise<number> {
    const rows = await this.db.query(
      `update shop set sync_enabled = false, tenant_active = false, updated_at = now()
       where source = 'NEXCART' and (sync_enabled or tenant_active) and not (source_id = any($1::text[])) returning id`,
      [presentSourceIds],
    );
    return rows.length;
  }

  async markSyncOk(id: number, startedAt: Date, full: boolean) {
    await this.db.query(
      `update shop set last_sync_at = $2, last_sync_error = null, last_sync_error_at = null,
          last_full_sync_at = case when $3 then $2 else last_full_sync_at end, updated_at = now() where id = $1`,
      [id, startedAt, full],
    );
  }

  async markSyncFailed(id: number, message: string) {
    await this.db.query(`update shop set last_sync_error = $2, last_sync_error_at = now() where id = $1`, [id, message.slice(0, 500)]);
    await this.db.query(`insert into sync_error(shop_id, message) values ($1, $2)`, [id, message.slice(0, 500)]);
  }
}
