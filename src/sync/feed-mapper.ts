import { asciiSlug } from '../common/slug';
import { normalizeFa } from '../common/persian';
import { FeedProduct } from '../feed/feed.types';

export interface MappedListing {
  sourceProductId: string;
  sourceSlug: string;
  sourceCategoryKey: string | null;
  sourceCategoryName: string | null;
  sourceCategoryPath: string | null;
  title: string;
  brand: string | null;
  barcode: string | null;
  sku: string | null;
  shortDesc: string | null;
  price: number | null;
  compareAtPrice: number | null;
  available: boolean;
  stock: number;
  priceOnRequest: boolean;
  isDigital: boolean;
  customOrder: boolean;
  images: string[];
  specs: { name: string; value: string }[];
  variants: { id: string | null; name: string | null; sku: string | null; price: number | null; stock: number; options: Record<string, unknown>; imageUrl: string | null }[];
  hiddenBySeller: boolean;
  deleted: boolean;
  sourceStatus: string;
  sourceUpdatedAt: Date | null;
  catalogSlug: string;
  searchText: string;
}

/** Barcodes: digits only, 8/12/13/14 long (EAN-8, UPC-A, EAN-13, GTIN-14). Anything else is ignored, never guessed. */
export function cleanBarcode(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/[\s-]/g, '');
  return /^\d{8}$|^\d{12,14}$/.test(d) ? d : null;
}

export function plainText(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

const httpUrl = (u: string) => /^https?:\/\//i.test(u);

export function mapFeedProduct(item: FeedProduct, excludedCategoryIds: string[]): MappedListing {
  const variants = (item.variants ?? []).map((v) => ({
    id: v.id ?? null,
    name: v.name ?? null,
    sku: v.sku ?? null,
    price: v.price == null ? null : Number(v.price),
    stock: Number(v.stock ?? 0),
    options: (v.options && typeof v.options === 'object' ? v.options : {}) as Record<string, unknown>,
    imageUrl: v.imageUrl && httpUrl(v.imageUrl) ? v.imageUrl : null,
  }));

  const basePrice = Number(item.price);
  const onRequest = !!item.priceOnRequest;
  const hasVariants = variants.length > 0;
  const available = hasVariants ? variants.some((v) => v.stock > 0) : Number(item.stock) > 0;
  const stock = hasVariants ? variants.reduce((a, v) => a + Math.max(0, v.stock), 0) : Math.max(0, Number(item.stock) || 0);

  let price: number | null = null;
  if (!onRequest) {
    if (hasVariants) {
      const pool = variants.filter((v) => v.stock > 0);
      const src = pool.length ? pool : variants;
      price = Math.min(...src.map((v) => v.price ?? basePrice));
    } else price = basePrice;
    if (!Number.isFinite(price) || price! <= 0) price = null;
  }
  const compare = !hasVariants && item.compareAtPrice && price != null && Number(item.compareAtPrice) > price ? Number(item.compareAtPrice) : null;

  const specSeen = new Set<string>();
  const specs = (item.attributes ?? [])
    .filter((a) => a?.name && a?.value)
    .filter((a) => (specSeen.has(a.name) ? false : (specSeen.add(a.name), true)))
    .map((a) => ({ name: String(a.name).slice(0, 200), value: String(a.value).slice(0, 1000) }));

  const path = item.categoryPath?.trim() || null;
  const key = item.categoryId ? String(item.categoryId) : path ? `path:${path}` : null;
  const name = path ? path.split('/').pop()! : null;

  // seller hid the product, or hid the category / any ancestor (the feed only checks the product's own category)
  const chain = item.categoryChainIds?.length ? item.categoryChainIds : item.categoryId ? [item.categoryId] : [];
  const hiddenByCategory = chain.some((id) => excludedCategoryIds.includes(id));

  const brand = item.brandName?.trim() || null;
  const barcode = cleanBarcode(item.barcode ?? item.gtin);
  const title = String(item.title).trim().slice(0, 500);

  return {
    sourceProductId: String(item.id),
    sourceSlug: String(item.slug),
    sourceCategoryKey: key,
    sourceCategoryName: name,
    sourceCategoryPath: path,
    title,
    brand,
    barcode,
    sku: item.sku ?? null,
    shortDesc: plainText(item.shortDescription ?? item.description, 300),
    price,
    compareAtPrice: compare,
    available,
    stock,
    priceOnRequest: onRequest,
    isDigital: !!item.isDigital,
    customOrder: !!item.customOrder,
    images: (item.images ?? []).filter((u) => typeof u === 'string' && httpUrl(u)).slice(0, 12),
    specs,
    variants,
    hiddenBySeller: !!item.hidden || hiddenByCategory,
    deleted: !!item.deleted,
    sourceStatus: String(item.status ?? 'ACTIVE'),
    sourceUpdatedAt: item.updatedAt ? new Date(item.updatedAt) : null,
    catalogSlug: asciiSlug(`${brand && /[a-z]/i.test(brand) ? brand + ' ' : ''}${title}`),
    searchText: normalizeFa([title, brand, ...specs.slice(0, 20).map((s) => s.value)].filter(Boolean).join(' ')).slice(0, 2000),
  };
}
