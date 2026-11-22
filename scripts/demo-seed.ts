/**
 * Dev-only: fills DATABASE_URL with demo shops/products using the signed mock feed, then keeps the mock feed + images
 * alive on port 4777 so the images in the demo load. Never run against production.
 */
import { createServer } from 'http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CategoriesService } from '../src/catalog/categories.service';
import { DbService } from '../src/db/db.service';
import { migrate } from '../src/db/migrator';
import { SyncService } from '../src/sync/sync.service';
import { merchant, MockState, product, startMockFeed } from '../test/mock-feed';

const COLORS = ['#dbeafe', '#fde68a', '#bbf7d0', '#fecaca', '#e9d5ff', '#fed7aa'];

async function main() {
  const imgServer = createServer((req, res) => {
    const n = Number(/(\d+)/.exec(req.url ?? '')?.[1] ?? 0);
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${COLORS[n % COLORS.length]}"/><rect x="130" y="70" width="140" height="260" rx="22" fill="#fff" opacity=".85"/><circle cx="200" cy="300" r="14" fill="#94a3b8"/></svg>`);
  });
  await new Promise<void>((r) => imgServer.listen(4778, '127.0.0.1', r));
  const img = (n: number) => `http://127.0.0.1:4778/${n}.svg`;

  const state: MockState = { merchants: [], products: {}, productRequests: [], failProducts: false };
  const feed = await startMockFeed(state);
  process.env.NEXCART_FEED_URL = feed.url;
  process.env.SYNC_ENABLED = 'false';

  const phones = [
    ['گوشی سامسونگ Galaxy A55 ظرفیت 256 گیگابایت', 'Samsung', 14_800_000], ['گوشی شیائومی Redmi Note 13 Pro', 'Xiaomi', 12_900_000],
    ['گوشی اپل iPhone 15 ظرفیت 128 گیگابایت', 'Apple', 48_500_000], ['گوشی سامسونگ Galaxy S24 Ultra', 'Samsung', 62_000_000],
    ['گوشی موتورولا Moto G84', 'Motorola', 9_400_000], ['گوشی ناتینگ فون Nothing Phone 2a', 'Nothing', 16_700_000],
  ] as const;
  const laptops = [['لپ‌تاپ ایسوس Vivobook 15', 'Asus', 28_900_000], ['لپ‌تاپ لنوو IdeaPad Slim 3', 'Lenovo', 24_300_000], ['لپ‌تاپ اچ‌پی Pavilion 14', 'HP', 31_000_000]] as const;
  const spec = (extra: Record<string, string> = {}) => [{ name: 'رنگ', value: 'مشکی' }, { name: 'گارانتی', value: '18 ماه' }, { name: 'کشور سازنده', value: 'ویتنام' }, ...Object.entries(extra).map(([name, value]) => ({ name, value }))];
  let k = 0;
  const mk = (t: readonly [string, string, number], cat: string, delta = 0) => product({ id: `d${++k}`, title: t[0], slug: `${t[1].toLowerCase()}-${k}`, brandName: t[1], price: t[2] + delta, categoryPath: cat, images: [img(k), img(k + 1)],
    attributes: spec({ 'حافظه داخلی': '256 گیگابایت', 'اندازه صفحه': '6.6 اینچ', 'سیستم عامل': 'Android' }), shortDescription: 'نمونه‌ی آزمایشی برای نمایش صفحه‌ی محصول.' });

  state.merchants = [
    merchant({ tenantId: 'd1', name: 'دیجی‌گجت', subdomain: 'gadget', storeUrl: 'https://gadget.nexcart.ir', city: 'تهران', shippingHours: 24, ratingAvg: 4.6, ratingCount: 38 }),
    merchant({ tenantId: 'd2', name: 'موبایل‌سرای مهر', subdomain: 'mehr', storeUrl: 'https://mehr-mobile.ir', city: 'مشهد', shippingHours: 72, freeShippingAbove: 20_000_000 }),
    merchant({ tenantId: 'd3', name: 'کامپیوتر آراد', subdomain: 'arad', storeUrl: 'https://arad.nexcart.ir', city: 'اصفهان', shippingHours: 48 }),
  ];
  state.products.d1 = [...phones.slice(0, 5).map((p) => mk(p, 'موبایل/گوشی')), ...laptops.map((l) => mk(l, 'لپ‌تاپ'))];
  state.products.d2 = [...phones.map((p, i) => mk(p, 'گوشی هوشمند', i % 2 ? 150_000 : -200_000))];
  state.products.d3 = laptops.map((l) => mk(l, 'لپ‌تاپ', 400_000));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  await migrate(app.get(DbService).pool);
  await app.get(SyncService).syncAll({ full: true });

  const cats = app.get(CategoriesService);
  const db = app.get(DbService);
  const root = await cats.create({ name: 'موبایل و تبلت', slug: 'mobile', sortOrder: 1 });
  const ph = await cats.create({ name: 'گوشی موبایل', slug: 'phones', parentId: root!.id });
  const lap = await cats.create({ name: 'لپ‌تاپ', slug: 'laptops', sortOrder: 2 });
  const scs = await db.query<{ id: number; name: string }>('select id, name from source_category');
  await cats.setMapping(scs.filter((s) => ['گوشی', 'گوشی هوشمند'].includes(s.name)).map((s) => s.id), ph!.id);
  await cats.setMapping(scs.filter((s) => s.name === 'لپ‌تاپ').map((s) => s.id), lap!.id);
  console.log('demo ready; feed+images stay up on :4778. Ctrl+C to stop');
  setInterval(() => undefined, 1 << 30);
}
main().catch((e) => { console.error(e); process.exit(1); });
