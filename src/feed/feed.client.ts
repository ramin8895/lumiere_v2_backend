import { Inject, Injectable } from '@nestjs/common';
import { signRequest } from '../common/hmac';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { FeedMerchant, FeedPage } from './feed.types';

export class FeedError extends Error {}

/** Signed GET client for the NexCart feed. The signature covers the exact path + query that is sent. */
@Injectable()
export class FeedClient {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    if (!this.cfg.secret) throw new FeedError('LUMIERE_SYNC_SECRET is not configured');
    const url = new URL(`${this.cfg.feedUrl}${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const pathWithQuery = url.pathname + url.search;
    const ts = String(Date.now());
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'x-lumiere-timestamp': ts,
          'x-lumiere-signature': signRequest(this.cfg.secret, ts, 'GET', pathWithQuery),
        },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new FeedError(`feed ${path} -> HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof FeedError) throw e;
      const err = e as Error;
      throw new FeedError(`feed ${path} failed: ${err.name === 'AbortError' ? 'timeout' : err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async merchants(): Promise<FeedMerchant[]> {
    const res = await this.get<{ items: FeedMerchant[] }>('/merchants');
    return Array.isArray(res.items) ? res.items : [];
  }

  products(p: { tenantId: string; since?: string; cursor?: string; limit?: number }): Promise<FeedPage> {
    return this.get<FeedPage>('/products', { tenantId: p.tenantId, since: p.since, cursor: p.cursor, limit: p.limit ?? 200 });
  }
}
