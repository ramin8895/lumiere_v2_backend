/**
 * Feed contract with nexcart-api (`/api/lumiere/sync/*`).
 * Fields marked "v2" are added by the NexCart-side fixes (docs/FEED_CONTRACT.md);
 * the parser tolerates their absence so today's feed keeps working.
 */
export interface FeedMerchant {
  tenantId: string;
  name: string;
  subdomain: string;
  storeUrl: string;
  logoUrl?: string | null;
  description?: string | null;
  phone?: string | null;
  city?: string | null;
  ratingAvg?: number;
  ratingCount?: number;
  shippingHours?: number | null;
  freeShippingAbove?: number | null;
  syncEnabled: boolean;
  isActive: boolean;
  excludedCategoryIds?: string[];
  subscriptionActive?: boolean; // v2
  showPhone?: boolean; // v2
}

export interface FeedVariant {
  id?: string; // v2
  name?: string | null;
  sku?: string | null; // v2
  price?: number | null;
  stock?: number;
  options?: Record<string, unknown> | null;
  imageUrl?: string | null; // v2
}

export interface FeedProduct {
  id: string;
  title: string;
  slug: string;
  sku?: string | null;
  gtin?: string | null;
  barcode?: string | null; // v2 (same as gtin)
  shortDescription?: string | null;
  description?: string | null;
  price: number;
  compareAtPrice?: number | null;
  stock: number;
  status: string;
  brandName?: string | null;
  categoryPath?: string | null;
  categoryId?: string | null; // v2
  categoryChainIds?: string[]; // v2: own id first, then ancestors
  images: string[];
  attributes: { name: string; value: string }[];
  variants: FeedVariant[];
  priceOnRequest?: boolean; // v2
  isDigital?: boolean; // v2
  customOrder?: boolean; // v2
  updatedAt: string;
  hidden: boolean;
  deleted: boolean;
}

export interface FeedPage {
  items: FeedProduct[];
  nextCursor: string | null;
  total: number;
}
