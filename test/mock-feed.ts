import { createHmac, timingSafeEqual } from 'crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';

export const SECRET = 'test-secret-test-secret-test-secret';

/** Independent re-implementation of NexCart's signature check, so the client is verified against the documented scheme. */
function valid(req: IncomingMessage): boolean {
  const ts = req.headers['x-lumiere-timestamp'];
  const sig = req.headers['x-lumiere-signature'];
  if (typeof ts !== 'string' || typeof sig !== 'string') return false;
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return false;
  const exp = createHmac('sha256', SECRET).update(`${ts}.${req.method!.toUpperCase()}.${req.url}`).digest('hex');
  return exp.length === sig.length && timingSafeEqual(Buffer.from(exp), Buffer.from(sig));
}

export interface MockState {
  merchants: any[];
  products: Record<string, any[]>; // by tenantId
  productRequests: { tenantId: string; since?: string; cursor?: string }[];
  failProducts: boolean;
}

export async function startMockFeed(state: MockState): Promise<{ server: Server; url: string }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!valid(req)) return send(401, { message: 'bad signature' });
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/api/lumiere/sync/merchants') return send(200, { items: state.merchants });
    if (url.pathname === '/api/lumiere/sync/products') {
      if (state.failProducts) return send(500, { message: 'boom' });
      const tenantId = url.searchParams.get('tenantId')!;
      const since = url.searchParams.get('since') ?? undefined;
      const cursor = url.searchParams.get('cursor') ?? undefined;
      state.productRequests.push({ tenantId, since, cursor });
      const limit = Math.min(500, Number(url.searchParams.get('limit') ?? 200));
      let all = (state.products[tenantId] ?? []).slice().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
      if (since) all = all.filter((p) => p.updatedAt >= since);
      const start = cursor ? Number(Buffer.from(cursor, 'base64url').toString()) : 0;
      const items = all.slice(start, start + limit);
      const next = start + limit < all.length ? Buffer.from(String(start + limit)).toString('base64url') : null;
      return send(200, { items, nextCursor: next, total: all.length });
    }
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/lumiere/sync` };
}

export function merchant(over: Partial<any> = {}) {
  return { tenantId: 't1', name: 'فروشگاه یک', subdomain: 'shop1', storeUrl: 'https://shop1.nexcart.ir', logoUrl: null, description: null, phone: '09120000000',
    city: 'تهران', ratingAvg: 4.5, ratingCount: 10, shippingHours: 24, freeShippingAbove: 1000000, syncEnabled: true, isActive: true, excludedCategoryIds: [], ...over };
}

let seq = 0;
export function product(over: Partial<any> = {}) {
  const n = ++seq;
  return {
    id: `p${n}`, title: `محصول ${n}`, slug: `product-${n}`, sku: null, gtin: null, shortDescription: 'توضیح کوتاه', description: '<p>توضیح</p>',
    price: 100000 + n, compareAtPrice: null, stock: 5, status: 'ACTIVE', brandName: null, categoryPath: 'موبایل', images: [`https://img.test/${n}.jpg`],
    attributes: [{ name: 'رنگ', value: 'مشکی' }], variants: [], updatedAt: new Date(Date.UTC(2026, 10, 1, 0, 0, n)).toISOString(), hidden: false, deleted: false, ...over,
  };
}
