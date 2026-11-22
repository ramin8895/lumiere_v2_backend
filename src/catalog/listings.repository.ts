import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { MappedListing } from '../sync/feed-mapper';

@Injectable()
export class ListingsRepository {
  constructor(private readonly db: DbService) {}

  /** source category row for (shop, key); name/path refreshed on every sync */
  async upsertSourceCategory(c: PoolClient, shopId: number, key: string, name: string, path: string): Promise<number> {
    const row = await this.db.one<{ id: number }>(
      `insert into source_category(shop_id, source_id, name, path) values ($1,$2,$3,$4)
       on conflict (shop_id, source_id) do update set name = excluded.name, path = excluded.path returning id`,
      [shopId, key, name, path],
      c,
    );
    return row!.id;
  }

  async categoryForSource(c: PoolClient, sourceCategoryId: number): Promise<number | null> {
    const row = await this.db.one<{ category_id: number }>('select category_id from category_mapping where source_category_id = $1', [sourceCategoryId], c);
    return row?.category_id ?? null;
  }

  /**
   * Insert or update one listing. A brand-new listing starts as its own catalog product (merging happens later);
   * an existing listing refreshes its catalog product only while it is that product's primary listing.
   */
  async upsert(c: PoolClient, shopId: number, m: MappedListing, sourceCategoryId: number | null, categoryId: number | null, runStart: Date): Promise<'created' | 'updated'> {
    const existing = await this.db.one<{ id: number; catalog_product_id: number }>(
      'select id, catalog_product_id from listing where shop_id = $1 and source_product_id = $2', [shopId, m.sourceProductId], c);

    const common = [
      m.sourceSlug, sourceCategoryId, categoryId, m.title, m.brand, m.barcode, m.sku, m.shortDesc, m.price, m.compareAtPrice,
      m.available, m.stock, m.priceOnRequest, m.isDigital, m.customOrder, JSON.stringify(m.images), JSON.stringify(m.specs),
      JSON.stringify(m.variants), m.hiddenBySeller, m.deleted, m.sourceStatus, m.sourceUpdatedAt, runStart,
    ];

    if (!existing) {
      const cp = await this.db.one<{ id: number }>(
        `insert into catalog_product(slug, title, brand, category_id, barcode, short_desc, images, specs, search_text)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [m.catalogSlug, m.title, m.brand, categoryId, m.barcode, m.shortDesc, JSON.stringify(m.images), JSON.stringify(m.specs), m.searchText], c);
      const l = await this.db.one<{ id: number }>(
        `insert into listing(catalog_product_id, shop_id, source_product_id, source_slug, source_category_id, category_id, title, brand, barcode, sku,
            short_desc, price, compare_at_price, available, stock, price_on_request, is_digital, custom_order, images, specs, variants,
            hidden_by_seller, deleted, source_status, source_updated_at, last_seen_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) returning id`,
        [cp!.id, shopId, m.sourceProductId, ...common], c);
      await this.db.query('update catalog_product set primary_listing_id = $2 where id = $1', [cp!.id, l!.id], c);
      return 'created';
    }

    await this.db.query(
      `update listing set source_slug=$2, source_category_id=$3, category_id=$4, title=$5, brand=$6, barcode=$7, sku=$8, short_desc=$9,
         price=$10, compare_at_price=$11, available=$12, stock=$13, price_on_request=$14, is_digital=$15, custom_order=$16,
         images=$17, specs=$18, variants=$19, hidden_by_seller=$20, deleted=$21, source_status=$22, source_updated_at=$23,
         last_seen_at=$24, updated_at=now() where id = $1`,
      [existing.id, ...common], c);

    await this.db.query(
      `update catalog_product set slug=$2, title=$3, brand=$4, barcode=$5, short_desc=$6, images=$7, specs=$8, search_text=$9, updated_at=now()
       where id = $1 and primary_listing_id = $10`,
      [existing.catalog_product_id, m.catalogSlug, m.title, m.brand, m.barcode, m.shortDesc, JSON.stringify(m.images), JSON.stringify(m.specs), m.searchText, existing.id], c);
    return 'updated';
  }

  /** Listings not seen during a completed full pass no longer exist in the store. */
  async markUnseenDeleted(shopId: number, passStart: Date): Promise<number> {
    const rows = await this.db.query(
      `update listing set deleted = true, updated_at = now() where shop_id = $1 and not deleted and last_seen_at < $2 returning id`,
      [shopId, passStart]);
    return rows.length;
  }
}
