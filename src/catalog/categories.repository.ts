import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface CategoryRow {
  id: number; parent_id: number | null; name: string; slug: string; image_url: string | null;
  sort_order: number; is_active: boolean; meta_title: string | null; meta_description: string | null;
}

@Injectable()
export class CategoriesRepository {
  constructor(private readonly db: DbService) {}

  all() {
    return this.db.query<CategoryRow>('select * from category order by sort_order, id');
  }
  byId(id: number) {
    return this.db.one<CategoryRow>('select * from category where id = $1', [id]);
  }
  bySlug(slug: string) {
    return this.db.one<CategoryRow>('select * from category where slug = $1', [slug]);
  }
  create(d: { parentId: number | null; name: string; slug: string; sortOrder: number; imageUrl: string | null; metaTitle: string | null; metaDescription: string | null }) {
    return this.db.one<CategoryRow>(
      `insert into category(parent_id, name, slug, sort_order, image_url, meta_title, meta_description) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [d.parentId, d.name, d.slug, d.sortOrder, d.imageUrl, d.metaTitle, d.metaDescription]);
  }
  async update(id: number, d: Partial<{ parentId: number | null; name: string; slug: string; sortOrder: number; imageUrl: string | null; isActive: boolean; metaTitle: string | null; metaDescription: string | null }>) {
    const map: Record<string, string> = { parentId: 'parent_id', name: 'name', slug: 'slug', sortOrder: 'sort_order', imageUrl: 'image_url', isActive: 'is_active', metaTitle: 'meta_title', metaDescription: 'meta_description' };
    const sets: string[] = []; const params: unknown[] = [id];
    for (const [k, col] of Object.entries(map)) if ((d as any)[k] !== undefined) { params.push((d as any)[k]); sets.push(`${col} = $${params.length}`); }
    if (!sets.length) return this.byId(id);
    return this.db.one<CategoryRow>(`update category set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`, params);
  }
  async remove(id: number) {
    await this.db.query('delete from category where id = $1', [id]);
  }
  async childCount(id: number): Promise<number> {
    return (await this.db.one<{ n: number }>('select count(*)::int as n from category where parent_id = $1', [id]))!.n;
  }
  async mappingCount(id: number): Promise<number> {
    return (await this.db.one<{ n: number }>('select count(*)::int as n from category_mapping where category_id = $1', [id]))!.n;
  }
  /** ids of the category and all ACTIVE descendants (an inactive branch is cut off) */
  async subtreeIds(id: number): Promise<number[]> {
    const rows = await this.db.query<{ id: number }>(
      `with recursive t as (
         select id from category where id = $1 and is_active
         union all select c.id from category c join t on c.parent_id = t.id where c.is_active
       ) select id from t`, [id]);
    return rows.map((r) => r.id);
  }
  /** direct product counts per category (visible products only) */
  directCounts() {
    return this.db.query<{ category_id: number; n: number }>(
      `select category_id, count(*)::int as n from catalog_product where status = 'ACTIVE' and offer_count > 0 and category_id is not null group by category_id`);
  }
}
