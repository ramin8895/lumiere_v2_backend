import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { tokensFa } from '../common/persian';

export type ProductSort = 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'offers';

export interface ProductQuery {
  categoryIds?: number[];
  q?: string;
  shopId?: number;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort: ProductSort;
  limit: number;
  offset: number;
}

/** below this many exact matches the typo-tolerant fallback is used */
const FUZZY_BELOW = 5;

const CARD = `cp.id, cp.slug, cp.title, cp.brand, cp.images->>0 as image, cp.offer_count, cp.price_min, cp.price_max, cp.in_stock, cp.category_id`;

@Injectable()
export class PublicRepository {
  constructor(private readonly db: DbService) {}

  /**
   * Product cards (one per catalog product).
   * Search is two-phase: every token as a substring (fast); only when that finds fewer than FUZZY_BELOW products
   * the trigram "word similarity" fallback is added (typos). The fallback is far slower, so it must not run on every query.
   */
  async products(p: ProductQuery) {
    const tokens = p.q ? tokensFa(p.q) : [];
    if (!tokens.length) return this.run(p, tokens, false);
    const strict = await this.run({ ...p, limit: 1, offset: 0 }, tokens, false);
    const fuzzy = strict.total < FUZZY_BELOW;
    return fuzzy ? this.run(p, tokens, true) : this.run(p, tokens, false);
  }

  private async run(p: ProductQuery, tokens: string[], fuzzy: boolean) {
    const where: string[] = [`cp.status = 'ACTIVE'`, `cp.offer_count > 0`];
    const params: unknown[] = [];
    const add = (v: unknown) => (params.push(v), `$${params.length}`);

    if (p.categoryIds) where.push(`cp.category_id = any(${add(p.categoryIds)}::bigint[])`);
    if (p.brand) where.push(`cp.brand = ${add(p.brand)}`);
    if (p.minPrice !== undefined) where.push(`cp.price_max >= ${add(p.minPrice)}`);
    if (p.maxPrice !== undefined) where.push(`cp.price_min <= ${add(p.maxPrice)}`);
    if (p.inStock) where.push('cp.in_stock');
    if (p.shopId) where.push(`exists (select 1 from listing l where l.catalog_product_id = cp.id and l.shop_id = ${add(p.shopId)} and l.product_ok)`);

    let rank = '';
    if (tokens.length) {
      const likes = tokens.map((t) => `cp.search_text like ${add('%' + t.replace(/[\\%_]/g, '\\$&') + '%')}`).join(' and ');
      if (fuzzy) {
        // the parameter is only registered when the SQL really uses it (unused params make Postgres fail)
        const joined = add(tokens.join(' '));
        where.push(`((${likes}) or ${joined} <% cp.search_text)`);
        rank = `word_similarity(${joined}, cp.search_text)`;
      } else where.push(`(${likes})`);
    }

    const order = {
      relevance: fuzzy ? `${rank} desc, cp.offer_count desc, cp.id desc` : 'cp.offer_count desc, cp.id desc',
      newest: 'cp.id desc',
      price_asc: 'cp.in_stock desc, cp.price_min asc nulls last, cp.id desc',
      price_desc: 'cp.in_stock desc, cp.price_min desc nulls last, cp.id desc',
      offers: 'cp.offer_count desc, cp.id desc',
    }[p.sort];

    const whereSql = where.join(' and ');
    const countParams = params.slice();
    const items = await this.db.query(
      `select ${CARD} from catalog_product cp where ${whereSql} order by ${order} limit ${add(p.limit)} offset ${add(p.offset)}`, params);
    const total = (await this.db.one<{ n: number }>(`select count(*)::int as n from catalog_product cp where ${whereSql}`, countParams))!.n;
    return { items, total };
  }

  brands(categoryIds?: number[]) {
    return this.db.query<{ brand: string; n: number }>(
      `select brand, count(*)::int as n from catalog_product where status='ACTIVE' and offer_count>0 and brand is not null
       ${categoryIds ? 'and category_id = any($1::bigint[])' : ''} group by brand order by n desc, brand limit 50`,
      categoryIds ? [categoryIds] : []);
  }

  async suggest(q: string, limit = 8) {
    const tokens = tokensFa(q);
    if (!tokens.length) return [];
    const run = (fuzzy: boolean) => {
      const params: unknown[] = [];
      const joined = fuzzy ? (params.push(tokens.join(' ')), `$${params.length}`) : '';
      const likes = tokens.map((t) => (params.push('%' + t.replace(/[\\%_]/g, '\\$&') + '%'), `search_text like $${params.length}`)).join(' and ');
      params.push(limit);
      return this.db.query(
        `select id, slug, title, images->>0 as image from catalog_product
         where status='ACTIVE' and offer_count>0 and ${fuzzy ? `((${likes}) or ${joined} <% search_text)` : `(${likes})`}
         order by ${fuzzy ? `word_similarity(${joined}, search_text) desc,` : ''} offer_count desc limit $${params.length}`, params);
    };
    const strict = await run(false);
    return strict.length >= 3 ? strict : run(true);
  }

  productRow(id: number) {
    return this.db.one<any>(`select cp.*, jsonb_array_length(cp.specs) as spec_count from catalog_product cp where cp.id = $1`, [id]);
  }

  redirectFor(oldId: number) {
    return this.db.one<{ new_id: number }>('select new_id from slug_redirect where old_id = $1', [oldId]);
  }

  /** Offers for a product page: in-stock first, then cheapest. Store URLs are NOT exposed (buttons go through /go). */
  offers(catalogProductId: number) {
    return this.db.query(
      `select l.id as listing_id, l.title, l.price, l.compare_at_price, l.available, l.stock, l.price_on_request, l.variants,
              s.id as shop_id, s.slug as shop_slug, s.name as shop_name, s.logo_url, s.city, s.shipping_hours, s.free_shipping_above,
              s.rating_avg, s.rating_count
       from listing l join shop s on s.id = l.shop_id
       where l.catalog_product_id = $1 and l.product_ok and s.eligible
       order by l.available desc, l.price asc nulls last, l.id`, [catalogProductId]);
  }

  shops(limit: number, offset: number) {
    return this.db.query(
      `select id, slug, name, logo_url, city, description, shipping_hours, free_shipping_above, rating_avg, rating_count, displayable_count
       from shop where eligible order by displayable_count desc, id limit $1 offset $2`, [limit, offset]);
  }

  async shopBySlug(slug: string) {
    return this.db.one<any>(
      `select id, slug, name, logo_url, city, description, phone, show_phone, shipping_hours, free_shipping_above, rating_avg, rating_count, displayable_count
       from shop where slug = $1 and eligible`, [slug]);
  }

  /** Shop page listing: one card per listing (a shop's own products), each linking to the catalog product page. */
  shopProducts(shopId: number, limit: number, offset: number) {
    return this.db.query(
      `select cp.id, cp.slug, l.title, cp.brand, l.images->>0 as image, l.price as price_min, l.price as price_max, l.available as in_stock, cp.offer_count
       from listing l join catalog_product cp on cp.id = l.catalog_product_id
       where l.shop_id = $1 and l.product_ok and cp.status = 'ACTIVE' order by l.updated_at desc, l.id desc limit $2 offset $3`, [shopId, limit, offset]);
  }

  sitemapProducts(limit: number, offset: number) {
    return this.db.query(
      `select id, slug, updated_at from catalog_product
       where status='ACTIVE' and offer_count>0 and jsonb_array_length(images)>0 and jsonb_array_length(specs)>=3
       order by id limit $1 offset $2`, [limit, offset]);
  }
  async sitemapProductCount() {
    return (await this.db.one<{ n: number }>(
      `select count(*)::int as n from catalog_product where status='ACTIVE' and offer_count>0 and jsonb_array_length(images)>0 and jsonb_array_length(specs)>=3`))!.n;
  }
}
