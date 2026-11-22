import { Injectable, NotFoundException } from '@nestjs/common';
import { CategoriesRepository } from '../catalog/categories.repository';
import { CategoriesService } from '../catalog/categories.service';
import { PublicRepository, ProductSort } from './public.repository';

const MIN_INDEXABLE_SPECS = 3;

@Injectable()
export class PublicService {
  constructor(
    private readonly repo: PublicRepository,
    private readonly cats: CategoriesRepository,
    private readonly catsService: CategoriesService,
  ) {}

  categories() {
    return this.catsService.tree(true);
  }

  async category(slug: string, q: { page: number; pageSize: number; sort: ProductSort; q?: string; brand?: string; minPrice?: number; maxPrice?: number; inStock?: boolean; shop?: string }) {
    const cat = await this.cats.bySlug(slug);
    if (!cat || !cat.is_active) throw new NotFoundException();
    const ids = await this.cats.subtreeIds(cat.id);
    const tree = await this.catsService.tree(true);
    const node = findNode(tree, cat.id);
    const products = await this.listProducts({ ...q, categoryIds: ids });
    return {
      category: { id: cat.id, name: cat.name, slug: cat.slug, imageUrl: cat.image_url, metaTitle: cat.meta_title, metaDescription: cat.meta_description },
      breadcrumb: (await this.catsService.breadcrumb(cat.id)).map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      children: ((node?.children ?? []) as any[]).map((c: any) => ({ id: c.id, name: c.name, slug: c.slug, imageUrl: c.image_url, productCount: c.product_count })),
      brands: await this.repo.brands(ids),
      ...products,
      // thin categories stay out of the index
      indexable: products.total >= 3 && q.page === 1 && q.sort === 'relevance' && !q.q && !q.brand && q.minPrice === undefined && q.maxPrice === undefined && !q.inStock && !q.shop,
    };
  }

  async listProducts(q: { categoryIds?: number[]; page: number; pageSize: number; sort: ProductSort; q?: string; brand?: string; minPrice?: number; maxPrice?: number; inStock?: boolean; shop?: string }) {
    let shopId: number | undefined;
    if (q.shop) {
      const shop = await this.repo.shopBySlug(q.shop);
      if (!shop) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
      shopId = shop.id;
    }
    const { items, total } = await this.repo.products({
      categoryIds: q.categoryIds, q: q.q, shopId, brand: q.brand, minPrice: q.minPrice, maxPrice: q.maxPrice, inStock: q.inStock,
      sort: q.q && q.sort === 'relevance' ? 'relevance' : q.sort === 'relevance' ? 'offers' : q.sort,
      limit: q.pageSize, offset: (q.page - 1) * q.pageSize,
    });
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  suggest(q: string) {
    return this.repo.suggest(q);
  }

  async product(id: number) {
    const row = await this.repo.productRow(id);
    if (!row) {
      const red = await this.repo.redirectFor(id);
      if (red) return { redirectTo: red.new_id };
      throw new NotFoundException();
    }
    if (row.status === 'MERGED' && row.merged_into_id) return { redirectTo: row.merged_into_id };
    if (row.status !== 'ACTIVE' || row.offer_count < 1) throw new NotFoundException();
    const offers = await this.repo.offers(id);
    const crumbs = row.category_id ? await this.catsService.breadcrumb(row.category_id) : [];
    return {
      id: row.id, slug: row.slug, title: row.title, brand: row.brand, barcode: row.barcode, shortDesc: row.short_desc,
      images: row.images, specs: row.specs, updatedAt: row.updated_at,
      priceMin: row.price_min, priceMax: row.price_max, offerCount: row.offer_count, inStock: row.in_stock,
      breadcrumb: crumbs.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
      offers: offers.map((o: any) => ({
        listingId: o.listing_id, title: o.title, price: o.price, compareAtPrice: o.compare_at_price, available: o.available,
        priceOnRequest: o.price_on_request,
        variants: (o.variants as any[]).map((v) => ({ id: v.id, name: v.name, price: v.price ?? o.price, inStock: v.stock > 0 })),
        shop: { id: o.shop_id, slug: o.shop_slug, name: o.shop_name, logoUrl: o.logo_url, city: o.city, shippingHours: o.shipping_hours, freeShippingAbove: o.free_shipping_above, ratingAvg: o.rating_avg, ratingCount: o.rating_count },
      })),
      indexable: row.spec_count >= MIN_INDEXABLE_SPECS && row.images.length > 0,
    };
  }

  shops(page: number, pageSize: number) {
    return this.repo.shops(pageSize, (page - 1) * pageSize);
  }

  async shop(slug: string, page: number, pageSize: number) {
    const shop = await this.repo.shopBySlug(slug);
    if (!shop) throw new NotFoundException();
    const products = await this.repo.shopProducts(shop.id, pageSize, (page - 1) * pageSize);
    return {
      shop: {
        id: shop.id, slug: shop.slug, name: shop.name, logoUrl: shop.logo_url, city: shop.city, description: shop.description,
        phone: shop.show_phone ? shop.phone : null, shippingHours: shop.shipping_hours, freeShippingAbove: shop.free_shipping_above,
        ratingAvg: shop.rating_avg, ratingCount: shop.rating_count, productCount: shop.displayable_count,
      },
      products, page, pageSize,
    };
  }

  async sitemap(page: number, pageSize = 5000) {
    const total = await this.repo.sitemapProductCount();
    return { total, pages: Math.ceil(total / pageSize), items: await this.repo.sitemapProducts(pageSize, (page - 1) * pageSize) };
  }
}

function findNode(nodes: { id: number; children: any[] }[], id: number): any {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = findNode(n.children, id);
    if (f) return f;
  }
  return null;
}
