import { cleanBarcode, mapFeedProduct } from './feed-mapper';

const base: any = { id: 'p1', title: 'گوشی Samsung A55', slug: 'a55', price: 1000, stock: 2, status: 'ACTIVE', images: ['https://x/1.jpg', '/relative.jpg'],
  attributes: [{ name: 'رنگ', value: 'مشکی' }, { name: 'رنگ', value: 'سفید' }], variants: [], updatedAt: '2026-11-01T00:00:00Z', hidden: false, deleted: false, categoryPath: 'موبایل/گوشی' };

describe('mapFeedProduct', () => {
  it('maps a simple product', () => {
    const m = mapFeedProduct(base, []);
    expect(m.price).toBe(1000);
    expect(m.available).toBe(true);
    expect(m.images).toEqual(['https://x/1.jpg']); // relative urls are dropped, never guessed
    expect(m.specs).toEqual([{ name: 'رنگ', value: 'مشکی' }]); // duplicate names collapsed
    expect(m.sourceCategoryKey).toBe('path:موبایل/گوشی');
    expect(m.sourceCategoryName).toBe('گوشی');
    expect(m.catalogSlug).toBe('samsung-a55');
  });

  it('uses the cheapest AVAILABLE variant price and sums stock', () => {
    const m = mapFeedProduct({ ...base, variants: [{ id: 'v1', price: 500, stock: 0 }, { id: 'v2', price: 800, stock: 3 }, { id: 'v3', price: null, stock: 1 }] }, []);
    expect(m.price).toBe(800); // v1 is sold out, v3 falls back to product price 1000
    expect(m.stock).toBe(4);
    expect(m.available).toBe(true);
  });

  it('falls back to all variants when every variant is sold out', () => {
    const m = mapFeedProduct({ ...base, stock: 0, variants: [{ id: 'v1', price: 500, stock: 0 }, { id: 'v2', price: 800, stock: 0 }] }, []);
    expect(m.price).toBe(500);
    expect(m.available).toBe(false);
  });

  it('price on request has no price; zero or junk price is null', () => {
    expect(mapFeedProduct({ ...base, priceOnRequest: true }, []).price).toBeNull();
    expect(mapFeedProduct({ ...base, price: 0 }, []).price).toBeNull();
    expect(mapFeedProduct({ ...base, price: 'abc' as any }, []).price).toBeNull();
  });

  it('compare-at price only when higher than price and no variants', () => {
    expect(mapFeedProduct({ ...base, compareAtPrice: 1500 }, []).compareAtPrice).toBe(1500);
    expect(mapFeedProduct({ ...base, compareAtPrice: 900 }, []).compareAtPrice).toBeNull();
  });

  it('hides when the seller hid ANY ancestor category (the feed only checks the own category)', () => {
    const item = { ...base, categoryId: 'c3', categoryChainIds: ['c3', 'c2', 'c1'] };
    expect(mapFeedProduct(item, ['c1']).hiddenBySeller).toBe(true);
    expect(mapFeedProduct(item, ['zzz']).hiddenBySeller).toBe(false);
    expect(mapFeedProduct({ ...item, hidden: true }, []).hiddenBySeller).toBe(true);
  });

  it('uses the category id as key when the feed has one', () => {
    expect(mapFeedProduct({ ...base, categoryId: 'c9' }, []).sourceCategoryKey).toBe('c9');
  });
});

describe('cleanBarcode', () => {
  it('accepts EAN-8/12/13/14 only', () => {
    expect(cleanBarcode('6260012345678')).toBe('6260012345678');
    expect(cleanBarcode('1234-5678')).toBe('12345678');
    expect(cleanBarcode('123')).toBeNull();
    expect(cleanBarcode('ABC12345678')).toBeNull();
    expect(cleanBarcode(null)).toBeNull();
  });
});
