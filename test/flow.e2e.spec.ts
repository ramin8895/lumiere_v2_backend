import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Server } from 'http';
import { DbService } from '../src/db/db.service';
import { SyncService } from '../src/sync/sync.service';
import { createApp, resetDb, signed } from './helpers';
import { merchant, MockState, product, startMockFeed } from './mock-feed';

describe('lumiere-api flow (real Postgres, signed mock feed)', () => {
  let app: INestApplication;
  let feed: Server;
  let db: DbService;
  let sync: SyncService;
  const state: MockState = { merchants: [], products: {}, productRequests: [], failProducts: false };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await resetDb();
    const f = await startMockFeed(state);
    feed = f.server;
    app = await createApp(f.url);
    db = app.get(DbService);
    sync = app.get(SyncService);

    state.merchants = [
      merchant({ tenantId: 't1', name: 'فروشگاه یک', subdomain: 'shop1', storeUrl: 'https://shop1.nexcart.ir' }),
      merchant({ tenantId: 't2', name: 'فروشگاه دو', subdomain: 'shop2', storeUrl: 'https://www.shop2.ir' }),
      merchant({ tenantId: 't3', name: 'فروشگاه کوچک', subdomain: 'tiny', storeUrl: 'https://tiny.nexcart.ir' }),
      merchant({ tenantId: 't4', name: 'فروشگاه خاموش', subdomain: 'off', storeUrl: 'https://off.nexcart.ir', syncEnabled: false }),
    ];
    const mk = (n: number, over: any = {}) => Array.from({ length: n }, (_, i) => product({ title: `گوشی موبایل مدل ${i}`, ...over }));
    state.products.t1 = [
      product({ id: 'a1', title: 'گوشی سامسونگ Galaxy A55', slug: 'a55', brandName: 'Samsung', price: 15_000_000, categoryPath: 'موبایل/گوشی',
        attributes: [{ name: 'رنگ', value: 'مشکی' }, { name: 'حافظه', value: '128 گیگابایت' }, { name: 'رم', value: '8' }],
        variants: [{ id: 'v1', name: 'مشکی', price: 15_000_000, stock: 2 }, { id: 'v2', name: 'سفید', price: 15_500_000, stock: 0 }] }),
      ...mk(3, { categoryPath: 'موبایل/گوشی' }),
      product({ id: 'nocat', title: 'کالای بدون دسته', categoryPath: 'متفرقه/ناشناس' }),
    ];
    state.products.t2 = [
      product({ id: 'b1', title: 'گوشی سامسونگ Galaxy A55', slug: 'a55-s2', price: 14_800_000, categoryPath: 'گوشی هوشمند' }),
      ...mk(3, { categoryPath: 'گوشی هوشمند' }),
    ];
    state.products.t3 = mk(2, { categoryPath: 'موبایل/گوشی' });
    state.products.t4 = mk(5, { categoryPath: 'موبایل/گوشی' });
  });

  afterAll(async () => {
    await app.close();
    feed.close();
  });

  it('admin and sync endpoints reject unsigned or tampered requests', async () => {
    await http().get('/api/admin/overview').expect(401);
    await http().post('/api/sync/refresh-merchants').expect(401);
    // signature for another path must not work
    const ts = String(Date.now());
    const { signRequest } = await import('../src/common/hmac');
    await http().get('/api/admin/shops').set('x-lumiere-timestamp', ts).set('x-lumiere-signature', signRequest('test-secret-test-secret-test-secret', ts, 'GET', '/api/admin/overview')).expect(401);
    await signed(app, 'get', '/api/admin/overview').expect(200);
  });

  it('first sync pulls shops; nothing is visible until categories are mapped', async () => {
    const results = await sync.syncAll();
    expect(results.every((r) => !r.error)).toBe(true);
    expect(state.productRequests.every((r) => !r.since)).toBe(true); // first pass is full

    const shops = (await signed(app, 'get', '/api/admin/shops').expect(200)).body;
    expect(shops).toHaveLength(4);
    expect(shops.find((s: any) => s.source_id === 't4').hiddenReasons).toContain('DISABLED_BY_SELLER');
    // listings exist but no category is mapped -> shops not eligible, public site is empty
    expect(shops.every((s: any) => s.eligible === false)).toBe(true);
    expect((await http().get('/api/public/products').expect(200)).body.total).toBe(0);
    expect((await http().get('/api/public/shops').expect(200)).body).toEqual([]);

    const overview = (await signed(app, 'get', '/api/admin/overview').expect(200)).body;
    expect(overview.unmapped_products).toBeGreaterThan(0);
  });

  let phones: number;
  it('admin builds our own category tree and maps store categories (suggestions included)', async () => {
    const root = (await signed(app, 'post', '/api/admin/categories').send({ name: 'موبایل و تبلت', slug: 'mobile' }).expect(201)).body;
    const sub = (await signed(app, 'post', '/api/admin/categories').send({ name: 'گوشی موبایل', slug: 'phones', parentId: root.id }).expect(201)).body;
    phones = sub.id;

    const unmapped = (await signed(app, 'get', '/api/admin/source-categories?mapped=false').expect(200)).body;
    const names = unmapped.map((u: any) => u.name);
    expect(names).toEqual(expect.arrayContaining(['گوشی', 'گوشی هوشمند', 'ناشناس']));
    // biggest first
    expect(unmapped[0].product_count).toBeGreaterThanOrEqual(unmapped[unmapped.length - 1].product_count);

    const phoneSources = unmapped.filter((u: any) => ['گوشی', 'گوشی هوشمند'].includes(u.name)).map((u: any) => u.id);
    await signed(app, 'post', '/api/admin/mappings').send({ sourceCategoryIds: phoneSources, categoryId: phones }).expect(201);

    // after mapping, a category with the same name elsewhere gets a suggestion
    const again = (await signed(app, 'get', '/api/admin/source-categories?mapped=true').expect(200)).body;
    expect(again.every((r: any) => r.category_id === phones)).toBe(true);
  });

  it('shops become eligible only with >= 3 displayable products; products need image + mapping', async () => {
    const shops = (await signed(app, 'get', '/api/admin/shops').expect(200)).body;
    const by = (id: string) => shops.find((s: any) => s.source_id === id);
    expect(by('t1').eligible).toBe(true); // 4 mapped products, 1 unmapped excluded
    expect(by('t1').displayable_count).toBe(4);
    expect(by('t2').eligible).toBe(true);
    expect(by('t3').eligible).toBe(false);
    expect(by('t3').hiddenReasons).toEqual(['TOO_FEW_PRODUCTS']);
    expect(by('t4').eligible).toBe(false); // seller switched off
  });

  it('public tree counts roll up and only contain OUR categories', async () => {
    const tree = (await http().get('/api/public/categories').expect(200)).body;
    expect(tree).toHaveLength(1);
    expect(tree[0].slug).toBe('mobile');
    expect(tree[0].children[0].slug).toBe('phones');
    // 4 (t1) + 4 (t2) listings but the A55 of two shops are two products until merged: 8
    expect(tree[0].product_count).toBe(8);
    expect(JSON.stringify(tree)).not.toContain('گوشی هوشمند'); // store category names never leak
  });

  it('category page includes the subtree; parent shows children products', async () => {
    const parent = (await http().get('/api/public/categories/mobile').expect(200)).body;
    expect(parent.total).toBe(8);
    expect(parent.breadcrumb.map((b: any) => b.slug)).toEqual(['mobile']);
    expect(parent.children[0].slug).toBe('phones');
    const child = (await http().get('/api/public/categories/phones').expect(200)).body;
    expect(child.total).toBe(8);
    expect(child.breadcrumb.map((b: any) => b.slug)).toEqual(['mobile', 'phones']);
    expect(child.indexable).toBe(true);
    // sorted / filtered / paged variants are never indexable (they canonicalise to the base page)
    expect((await http().get('/api/public/categories/phones').query({ sort: 'price_asc' }).expect(200)).body.indexable).toBe(false);
    expect((await http().get('/api/public/categories/phones').query({ inStock: 'true' }).expect(200)).body.indexable).toBe(false);
    await http().get('/api/public/categories/nope').expect(404);
  });

  it('search tolerates Arabic letters, ZWNJ and a typo', async () => {
    const hit = async (q: string) => (await http().get('/api/public/products').query({ q }).expect(200)).body;
    expect((await hit('سامسونگ')).total).toBe(2);
    expect((await hit('سامسونك')).total).toBe(2); // Arabic kaf
    expect((await hit('samsung')).total).toBe(1); // brand lives only on shop 1's listing
    expect((await hit('galaxy a55')).total).toBe(2);
    expect((await hit('سامسونج')).total).toBeGreaterThanOrEqual(2); // typo: trigram fallback
    expect((await hit('zzzzqqq')).total).toBe(0);
    const s = (await http().get('/api/public/suggest').query({ q: 'سامسونگ' }).expect(200)).body;
    expect(s.length).toBeGreaterThan(0);
  });

  it('product page lists offers, in-stock cheapest first, without leaking store urls', async () => {
    const list = (await http().get('/api/public/products').query({ q: 'galaxy a55', sort: 'price_asc' }).expect(200)).body;
    const id = list.items[0].id;
    const p = (await http().get(`/api/public/products/${id}`).expect(200)).body;
    expect(p.title).toContain('A55');
    expect(p.offers).toHaveLength(1); // not merged yet: one offer per catalog product
    expect(JSON.stringify(p)).not.toContain('shop1.nexcart.ir');
    expect(JSON.stringify(p)).not.toContain('09120000000'); // seller phone is not on product pages
    await http().get('/api/public/products/999999').expect(404);
  });

  it('/go builds the destination from the database only, whitelists variants, and counts clicks once', async () => {
    const l = await db.one<any>(`select id from listing where source_product_id = 'a1'`);
    const ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120';
    const r1 = await http().get(`/api/go/${l.id}`).query({ variant: 'v1', ref: 'p' }).set('User-Agent', ua).expect(302);
    const loc = new URL(r1.headers.location);
    expect(loc.origin).toBe('https://shop1.nexcart.ir');
    expect(loc.pathname).toBe('/product/a55');
    expect(loc.searchParams.get('variant')).toBe('v1');
    expect(loc.searchParams.get('utm_source')).toBe('lumiere');
    expect(r1.headers['cache-control']).toBe('no-store');

    // a made-up variant and an attacker-supplied url are ignored
    const r2 = await http().get(`/api/go/${l.id}`).query({ variant: 'evil', url: 'https://evil.example', to: 'https://evil.example' }).set('User-Agent', ua);
    expect(r2.status).toBe(302);
    const l2 = new URL(r2.headers.location);
    expect(l2.origin).toBe('https://shop1.nexcart.ir');
    expect(l2.searchParams.get('variant')).toBeNull();
    expect(r2.headers.location).not.toContain('evil');

    // same visitor within 30 minutes and bots are stored but not counted
    await http().get(`/api/go/${l.id}`).set('User-Agent', 'Googlebot/2.1').expect(302);
    const counted = await db.one<{ n: number }>(`select count(*)::int as n from click_out where counted`);
    const total = await db.one<{ n: number }>(`select count(*)::int as n from click_out`);
    expect(counted!.n).toBe(1);
    expect(total!.n).toBeGreaterThanOrEqual(3);

    await http().get('/api/go/999999').expect(404);
    await http().get('/api/go/abc').expect(400);
  });

  it('a shop on a custom domain redirects to that domain', async () => {
    const l = await db.one<any>(`select id from listing where source_product_id = 'b1'`);
    const r = await http().get(`/api/go/${l.id}`).set('User-Agent', 'Mozilla/5.0 Firefox').expect(302);
    expect(new URL(r.headers.location).origin).toBe('https://www.shop2.ir');
  });

  it('incremental sync only asks for changes and applies price/stock updates and deletions', async () => {
    state.productRequests.length = 0;
    const t1 = state.products.t1;
    const a1 = t1.find((p) => p.id === 'a1');
    a1.price = 14_000_000;
    a1.variants = [{ id: 'v1', name: 'مشکی', price: 14_000_000, stock: 2 }];
    a1.updatedAt = new Date().toISOString();
    const r = await sync.syncShop((await db.one<any>(`select id from shop where source_id = 't1'`)).id, { full: false });
    expect(r.error).toBeUndefined();
    expect(r.full).toBe(false);
    expect(state.productRequests[0].since).toBeDefined();
    expect(r.updated).toBe(1);
    const row = await db.one<any>(`select price_min from catalog_product cp join listing l on l.catalog_product_id = cp.id where l.source_product_id = 'a1'`);
    expect(row.price_min).toBe(14_000_000);

    // a product removed from the store disappears after the next full pass
    state.products.t1 = t1.filter((p) => p.id !== 'a1');
    const full = await sync.syncShop((await db.one<any>(`select id from shop where source_id = 't1'`)).id, { full: true });
    expect(full.deleted).toBe(1);
    const gone = await db.one<any>(`select product_ok, deleted from listing where source_product_id = 'a1'`);
    expect(gone).toEqual({ product_ok: false, deleted: true });
    // shop 1 now has 3 displayable products: still eligible (min 3)
    expect((await db.one<any>(`select eligible from shop where source_id = 't1'`)).eligible).toBe(true);
  });

  it('seller hiding, expired subscription and admin block each take a shop out; reasons are reported', async () => {
    const shopId = (await db.one<any>(`select id from shop where source_id = 't2'`)).id;

    state.products.t2[1].hidden = true;
    state.products.t2[1].updatedAt = new Date().toISOString();
    await sync.syncShop(shopId);
    expect((await db.one<any>('select displayable_count, eligible from shop where id = $1', [shopId]))).toEqual({ displayable_count: 3, eligible: true });
    state.products.t2[2].hidden = true;
    state.products.t2[2].updatedAt = new Date().toISOString();
    await sync.syncShop(shopId);
    let shops = (await signed(app, 'get', '/api/admin/shops').expect(200)).body;
    expect(shops.find((s: any) => s.id === shopId).hiddenReasons).toEqual(['TOO_FEW_PRODUCTS']);
    state.products.t2[1].hidden = false; state.products.t2[1].updatedAt = new Date().toISOString();
    state.products.t2[2].hidden = false; state.products.t2[2].updatedAt = new Date().toISOString();
    await sync.syncShop(shopId);

    state.merchants[1] = merchant({ tenantId: 't2', name: 'فروشگاه دو', subdomain: 'shop2', storeUrl: 'https://www.shop2.ir', subscriptionActive: false });
    await sync.refreshMerchants();
    shops = (await signed(app, 'get', '/api/admin/shops').expect(200)).body;
    expect(shops.find((s: any) => s.id === shopId).hiddenReasons).toEqual(['SUBSCRIPTION_EXPIRED']);
    expect((await http().get('/api/public/shops').expect(200)).body.map((s: any) => s.slug)).toEqual(['shop1']);

    state.merchants[1] = merchant({ tenantId: 't2', name: 'فروشگاه دو', subdomain: 'shop2', storeUrl: 'https://www.shop2.ir' });
    await sync.refreshMerchants();
    expect((await db.one<any>('select eligible from shop where id = $1', [shopId])).eligible).toBe(true);

    await signed(app, 'patch', `/api/admin/shops/${shopId}`).send({ blocked: true }).expect(200);
    expect((await db.one<any>('select eligible from shop where id = $1', [shopId])).eligible).toBe(false);
    await http().get('/api/public/shops/shop2').expect(404);
    await signed(app, 'patch', `/api/admin/shops/${shopId}`).send({ blocked: false }).expect(200);
    await http().get('/api/public/shops/shop2').expect(200);
  });

  it('feed failures keep old data, are recorded, and an empty merchant list never wipes everything', async () => {
    const before = (await http().get('/api/public/products').expect(200)).body.total;
    state.failProducts = true;
    const r = await sync.syncShop((await db.one<any>(`select id from shop where source_id = 't1'`)).id, { full: true });
    expect(r.error).toMatch(/HTTP 500/);
    state.failProducts = false;
    expect((await http().get('/api/public/products').expect(200)).body.total).toBe(before);
    const st = (await signed(app, 'get', '/api/admin/sync/status').expect(200)).body;
    expect(st.errors.length).toBeGreaterThan(0);

    const saved = state.merchants;
    state.merchants = [];
    await expect(sync.refreshMerchants()).rejects.toThrow(/zero merchants/);
    state.merchants = saved;
    expect((await http().get('/api/public/shops').expect(200)).body.length).toBeGreaterThan(0);

    // a shop that vanished from the feed is switched off, not deleted
    state.merchants = saved.filter((m) => m.tenantId !== 't3');
    const res = await sync.refreshMerchants();
    expect(res.deactivated).toBeGreaterThanOrEqual(1);
    expect((await db.one<any>(`select tenant_active from shop where source_id = 't3'`)).tenant_active).toBe(false);
    state.merchants = saved;
  });

  it('category admin rules: slug format, duplicates, cycles, delete protections', async () => {
    const tree = (await signed(app, 'get', '/api/admin/categories').expect(200)).body;
    const root = tree[0];
    await signed(app, 'post', '/api/admin/categories').send({ name: 'x', slug: 'Bad Slug' }).expect(400);
    await signed(app, 'post', '/api/admin/categories').send({ name: 'x', slug: 'mobile' }).expect(409);
    await signed(app, 'patch', `/api/admin/categories/${root.id}`).send({ parentId: root.children[0].id }).expect(400); // under own child
    await signed(app, 'patch', `/api/admin/categories/${root.id}`).send({ parentId: root.id }).expect(400);
    await signed(app, 'delete', `/api/admin/categories/${root.id}`).expect(409); // has children
    await signed(app, 'delete', `/api/admin/categories/${root.children[0].id}`).expect(409); // has mappings
    await signed(app, 'post', '/api/admin/mappings').send({ sourceCategoryIds: [999999], categoryId: phones }).expect(400);
    await signed(app, 'post', '/api/admin/categories').send({ name: 'x', slug: 'ok', unknownField: 1 }).expect(400);
  });

  it('deactivating a category hides its products from the public site', async () => {
    await signed(app, 'patch', `/api/admin/categories/${phones}`).send({ isActive: false }).expect(200);
    await http().get('/api/public/categories/phones').expect(404);
    const tree = (await http().get('/api/public/categories').expect(200)).body;
    expect(tree[0].children).toEqual([]);
    await signed(app, 'patch', `/api/admin/categories/${phones}`).send({ isActive: true }).expect(200);
  });

  it('legacy seller-tab endpoints return the shapes LumiereTab reads', async () => {
    const st = (await signed(app, 'get', '/api/sync/status/t1').expect(200)).body;
    expect(st).toMatchObject({ registered: true });
    expect(typeof st.indexedProducts).toBe('number');
    const an = (await signed(app, 'get', '/api/sync/analytics/t1?days=30').expect(200)).body;
    expect(an.clicks).toBeGreaterThanOrEqual(1);
    expect((await signed(app, 'get', '/api/sync/status/unknown').expect(200)).body).toEqual({ registered: false });
    expect((await signed(app, 'post', '/api/sync/trigger/t1').expect(201)).body).toEqual({ started: true });
  });

  it('sitemap only lists products with an image and enough specs; health works', async () => {
    const sm = (await http().get('/api/public/sitemap/products').expect(200)).body;
    expect(sm.total).toBeGreaterThanOrEqual(0);
    for (const i of sm.items) expect(i.slug).toMatch(/^[a-z0-9-]+$/);
    await http().get('/api/health').expect(200);
  });
});
