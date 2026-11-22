import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface SourceCategoryRow {
  id: number; shop_id: number; shop_name: string; name: string; path: string;
  product_count: number; category_id: number | null;
}

@Injectable()
export class MappingRepository {
  constructor(private readonly db: DbService) {}

  list(filter: { mapped?: boolean; shopId?: number; limit: number; offset: number }) {
    const where: string[] = []; const params: unknown[] = [];
    if (filter.mapped === true) where.push('m.category_id is not null');
    if (filter.mapped === false) where.push('m.category_id is null');
    if (filter.shopId) { params.push(filter.shopId); where.push(`sc.shop_id = $${params.length}`); }
    params.push(filter.limit, filter.offset);
    return this.db.query<SourceCategoryRow>(
      `select sc.id, sc.shop_id, s.name as shop_name, sc.name, sc.path, m.category_id,
              (select count(*)::int from listing l where l.source_category_id = sc.id and not l.deleted and not l.hidden_by_seller) as product_count
       from source_category sc join shop s on s.id = sc.shop_id left join category_mapping m on m.source_category_id = sc.id
       ${where.length ? 'where ' + where.join(' and ') : ''}
       order by product_count desc, sc.id limit $${params.length - 1} offset $${params.length}`, params);
  }

  /** mapped source categories grouped by normalised-name candidates, used for suggestions */
  mappedNames() {
    return this.db.query<{ name: string; category_id: number }>(
      `select sc.name, m.category_id from source_category sc join category_mapping m on m.source_category_id = sc.id`);
  }

  async existing(ids: number[]): Promise<number[]> {
    const rows = await this.db.query<{ id: number }>('select id from source_category where id = any($1::bigint[])', [ids]);
    return rows.map((r) => r.id);
  }

  /** (un)map source categories and keep listing.category_id in step. categoryId null = unmap. */
  async set(ids: number[], categoryId: number | null): Promise<void> {
    await this.db.tx(async (c) => {
      if (categoryId === null) {
        await this.db.query('delete from category_mapping where source_category_id = any($1::bigint[])', [ids], c);
      } else {
        await this.db.query(
          `insert into category_mapping(source_category_id, category_id) select unnest($1::bigint[]), $2
           on conflict (source_category_id) do update set category_id = excluded.category_id`, [ids, categoryId], c);
      }
      await this.db.query('update listing set category_id = $2, updated_at = now() where source_category_id = any($1::bigint[])', [ids, categoryId], c);
    });
  }

  unmappedProductCount() {
    return this.db.one<{ n: number }>(
      `select count(*)::int as n from listing where category_id is null and not deleted and not hidden_by_seller`);
  }
}
