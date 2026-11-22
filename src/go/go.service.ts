import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DbService } from '../db/db.service';

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curl|wget|python-requests|headless/i;
const DEDUPE_MINUTES = 30;

@Injectable()
export class GoService {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, private readonly db: DbService) {}

  /**
   * Resolve the outgoing URL for a listing and record the click.
   * The destination is built ONLY from database values (store URL + the store's own product slug),
   * never from request input, so this cannot be used as an open redirect. `variant` is accepted
   * only if it is one of the listing's own variant ids.
   */
  async resolve(listingId: number, opts: { variant?: string; ref?: string; ip: string; ua: string }): Promise<string> {
    const l = await this.db.one<any>(
      `select l.id, l.shop_id, l.catalog_product_id, l.source_slug, l.variants, s.store_url
       from listing l join shop s on s.id = l.shop_id
       where l.id = $1 and l.product_ok and s.eligible`, [listingId]);
    if (!l) throw new NotFoundException();

    const url = new URL(`/product/${encodeURIComponent(l.source_slug)}`, l.store_url.endsWith('/') ? l.store_url : l.store_url + '/');
    // new URL with an absolute path would drop any path prefix of store_url; stores live at the origin root, so that is intended
    const variantIds = new Set((l.variants as any[]).map((v) => v.id).filter(Boolean));
    if (opts.variant && variantIds.has(opts.variant)) url.searchParams.set('variant', opts.variant);
    url.searchParams.set('utm_source', this.cfg.utmSource);
    url.searchParams.set('utm_medium', 'marketplace');

    const hash = createHash('sha256').update(`${this.cfg.hashSalt}|${opts.ip}|${opts.ua}`).digest('hex').slice(0, 32);
    const isBot = !opts.ua || BOT_RE.test(opts.ua);
    let counted = !isBot;
    if (counted) {
      const dup = await this.db.one(
        `select 1 from click_out where visitor_hash = $1 and listing_id = $2 and counted and created_at > now() - ($3 || ' minutes')::interval limit 1`,
        [hash, l.id, String(DEDUPE_MINUTES)]);
      if (dup) counted = false;
    }
    await this.db.query(
      `insert into click_out(listing_id, shop_id, catalog_product_id, ref, visitor_hash, counted) values ($1,$2,$3,$4,$5,$6)`,
      [l.id, l.shop_id, l.catalog_product_id, (opts.ref ?? '').slice(0, 100) || null, hash, counted]);
    return url.toString();
  }
}
