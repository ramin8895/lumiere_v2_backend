import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DbService, Queryable } from '../db/db.service';

/**
 * Single source of truth for visibility rules (set-based SQL).
 *
 *  product_ok : not deleted, not hidden by seller, has an image, category is mapped, source status ACTIVE
 *  shop.eligible : feed says sync enabled + tenant active + subscription active, not blocked by admin,
 *                  and at least MIN_SHOP_PRODUCTS products with product_ok
 *  catalog_product offers : listings with product_ok whose shop is eligible
 */
@Injectable()
export class EligibilityRepository {
  constructor(private readonly db: DbService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /** Recompute everything for one shop (or all shops when shopId is omitted). */
  async recompute(shopId?: number, q?: Queryable): Promise<void> {
    const run = (sql: string, params: unknown[]) => this.db.query(sql, params, q);
    const shopFilter = shopId === undefined ? '' : 'and l.shop_id = $1';
    const p1 = shopId === undefined ? [] : [shopId];

    // 1) product rules
    await run(
      `update listing l set product_ok = (
          not l.deleted and not l.hidden_by_seller and l.category_id is not null
          and jsonb_array_length(l.images) > 0 and coalesce(l.source_status, 'ACTIVE') = 'ACTIVE'
        )
        where l.product_ok is distinct from (
          not l.deleted and not l.hidden_by_seller and l.category_id is not null
          and jsonb_array_length(l.images) > 0 and coalesce(l.source_status, 'ACTIVE') = 'ACTIVE'
        ) ${shopFilter}`,
      p1,
    );

    // 2) shop rules
    const minParam = shopId === undefined ? 1 : 2;
    await run(
      `update shop s set
          displayable_count = c.n,
          eligible = c.ok,
          first_eligible_at = case when c.ok and s.first_eligible_at is null then now() else s.first_eligible_at end,
          updated_at = now()
        from (
          select sh.id,
                 count(l.id) filter (where l.product_ok) as n,
                 (sh.sync_enabled and sh.tenant_active and sh.subscription_active and not sh.blocked_by_admin
                  and count(l.id) filter (where l.product_ok) >= $${minParam}) as ok
          from shop sh left join listing l on l.shop_id = sh.id
          ${shopId === undefined ? '' : 'where sh.id = $1'}
          group by sh.id
        ) c
        where s.id = c.id and (s.displayable_count is distinct from c.n or s.eligible is distinct from c.ok)`,
      shopId === undefined ? [this.cfg.minShopProducts] : [shopId, this.cfg.minShopProducts],
    );

    // 3) catalog product aggregates (+ category from the primary listing)
    const scope = shopId === undefined ? '' : 'where cp.id in (select catalog_product_id from listing where shop_id = $1)';
    await run(
      `update catalog_product cp set
          offer_count = a.cnt, price_min = a.pmin, price_max = a.pmax, in_stock = a.instock,
          category_id = a.cat, updated_at = now()
        from (
          select cp.id,
                 count(l.id) filter (where l.product_ok and s.eligible) as cnt,
                 coalesce(min(l.price) filter (where l.product_ok and s.eligible and l.available),
                          min(l.price) filter (where l.product_ok and s.eligible)) as pmin,
                 max(l.price) filter (where l.product_ok and s.eligible) as pmax,
                 coalesce(bool_or(l.available) filter (where l.product_ok and s.eligible), false) as instock,
                 (select pl.category_id from listing pl where pl.id = cp.primary_listing_id) as cat
          from catalog_product cp
          left join listing l on l.catalog_product_id = cp.id
          left join shop s on s.id = l.shop_id
          ${scope}
          group by cp.id
        ) a
        where cp.id = a.id and (
          cp.offer_count is distinct from a.cnt or cp.price_min is distinct from a.pmin or cp.price_max is distinct from a.pmax
          or cp.in_stock is distinct from a.instock or cp.category_id is distinct from a.cat)`,
      p1,
    );
  }
}

/** Human readable reasons a shop is not shown (for the seller tab and the admin). */
export function shopHiddenReasons(
  s: { sync_enabled: boolean; tenant_active: boolean; subscription_active: boolean; blocked_by_admin: boolean; displayable_count: number },
  minProducts: number,
): string[] {
  const r: string[] = [];
  if (!s.sync_enabled) r.push('DISABLED_BY_SELLER');
  if (!s.tenant_active) r.push('STORE_INACTIVE');
  if (!s.subscription_active) r.push('SUBSCRIPTION_EXPIRED');
  if (s.blocked_by_admin) r.push('BLOCKED_BY_ADMIN');
  if (s.displayable_count < minProducts) r.push('TOO_FEW_PRODUCTS');
  return r;
}
