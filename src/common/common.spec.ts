import { signRequest, verifyRequest } from './hmac';
import { normalizeFa, tokensFa } from './persian';
import { asciiSlug, shopSlug } from './slug';

describe('normalizeFa', () => {
  it('unifies Arabic/Persian letters and digits', () => {
    expect(normalizeFa('كيف پول ١٢٣ ۴۵۶')).toBe('کیف پول 123 456');
  });
  it('turns ZWNJ into a space and strips harakat/tatweel', () => {
    expect(normalizeFa('می‌خواهم')).toBe('می خواهم');
    expect(normalizeFa('مُحَمَّد')).toBe('محمد');
    expect(normalizeFa('ســلام')).toBe('سلام');
  });
  it('lowercases latin and drops punctuation', () => {
    expect(normalizeFa('Samsung Galaxy S24-Ultra!')).toBe('samsung galaxy s24 ultra');
  });
  it('handles empty input', () => {
    expect(normalizeFa(null)).toBe('');
    expect(tokensFa('   ')).toEqual([]);
  });
});

describe('slugs', () => {
  it('keeps ascii parts only and falls back', () => {
    expect(asciiSlug('گوشی Samsung Galaxy S24')).toBe('samsung-galaxy-s24');
    expect(asciiSlug('گوشی موبایل')).toBe('product');
  });
  it('shop slug', () => {
    expect(shopSlug('My_Shop', 'x')).toBe('my-shop');
  });
});

describe('hmac', () => {
  const secret = 's'.repeat(32);
  it('accepts a correct signature and rejects tampering', () => {
    const ts = String(Date.now());
    const sig = signRequest(secret, ts, 'GET', '/api/x?tenantId=a');
    expect(verifyRequest(secret, ts, sig, 'GET', '/api/x?tenantId=a')).toBe(true);
    expect(verifyRequest(secret, ts, sig, 'GET', '/api/x?tenantId=b')).toBe(false);
    expect(verifyRequest(secret, ts, sig, 'POST', '/api/x?tenantId=a')).toBe(false);
  });
  it('rejects old timestamps and empty secret', () => {
    const ts = String(Date.now() - 6 * 60_000);
    const sig = signRequest(secret, ts, 'GET', '/p');
    expect(verifyRequest(secret, ts, sig, 'GET', '/p')).toBe(false);
    expect(verifyRequest('', String(Date.now()), 'x', 'GET', '/p')).toBe(false);
  });
});
