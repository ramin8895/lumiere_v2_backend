/** URL slug for catalog products: ASCII only (model numbers, latin brands); falls back to "product". */
export function asciiSlug(input: string | null | undefined, max = 60): string {
  const s = (input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s || 'product';
}

/** Slug for shops: subdomain is already URL safe; sanitise anyway. */
export function shopSlug(subdomain: string | null | undefined, fallback: string): string {
  const s = (subdomain ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || fallback.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}
