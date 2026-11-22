import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizeFa } from '../common/persian';
import { EligibilityRepository } from '../eligibility/eligibility.repository';
import { CategoriesRepository, CategoryRow } from './categories.repository';
import { MappingRepository } from './mapping.repository';

export interface CategoryNode extends Omit<CategoryRow, 'parent_id'> {
  parent_id: number | null;
  product_count: number; // including active descendants
  children: CategoryNode[];
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly cats: CategoriesRepository,
    private readonly mapping: MappingRepository,
    private readonly eligibility: EligibilityRepository,
  ) {}

  /** Our own tree only (never the stores' categories). `onlyActive` for the public site. */
  async tree(onlyActive: boolean): Promise<CategoryNode[]> {
    const [rows, counts] = await Promise.all([this.cats.all(), this.cats.directCounts()]);
    const direct = new Map(counts.map((c) => [c.category_id, c.n]));
    const nodes = new Map<number, CategoryNode>();
    for (const r of rows) nodes.set(r.id, { ...r, product_count: direct.get(r.id) ?? 0, children: [] });
    const roots: CategoryNode[] = [];
    for (const n of nodes.values()) {
      const parent = n.parent_id ? nodes.get(n.parent_id) : undefined;
      if (parent) parent.children.push(n);
      else roots.push(n);
    }
    const prune = (list: CategoryNode[]): CategoryNode[] => {
      const out: CategoryNode[] = [];
      for (const n of list) {
        if (onlyActive && !n.is_active) continue;
        n.children = prune(n.children);
        n.product_count += n.children.reduce((a, c) => a + c.product_count, 0);
        out.push(n);
      }
      return out;
    };
    return prune(roots);
  }

  async breadcrumb(id: number): Promise<CategoryRow[]> {
    const all = new Map((await this.cats.all()).map((c) => [c.id, c]));
    const chain: CategoryRow[] = [];
    for (let cur = all.get(id); cur; cur = cur.parent_id ? all.get(cur.parent_id) : undefined) {
      chain.unshift(cur);
      if (chain.length > 20) break;
    }
    return chain;
  }

  private assertSlug(slug: string) {
    if (!SLUG_RE.test(slug) || slug.length > 80) throw new BadRequestException('slug must be lowercase latin letters, digits and dashes');
  }

  async create(d: { parentId?: number | null; name: string; slug: string; sortOrder?: number; imageUrl?: string | null; metaTitle?: string | null; metaDescription?: string | null }) {
    this.assertSlug(d.slug);
    if (d.parentId && !(await this.cats.byId(d.parentId))) throw new BadRequestException('parent not found');
    if (await this.cats.bySlug(d.slug)) throw new ConflictException('slug already used');
    return this.cats.create({
      parentId: d.parentId ?? null, name: d.name.trim(), slug: d.slug, sortOrder: d.sortOrder ?? 0,
      imageUrl: d.imageUrl ?? null, metaTitle: d.metaTitle ?? null, metaDescription: d.metaDescription ?? null,
    });
  }

  async update(id: number, d: Partial<{ parentId: number | null; name: string; slug: string; sortOrder: number; imageUrl: string | null; isActive: boolean; metaTitle: string | null; metaDescription: string | null }>) {
    const cur = await this.cats.byId(id);
    if (!cur) throw new NotFoundException();
    if (d.slug !== undefined && d.slug !== cur.slug) {
      this.assertSlug(d.slug);
      if (await this.cats.bySlug(d.slug)) throw new ConflictException('slug already used');
    }
    if (d.parentId !== undefined && d.parentId !== null) {
      if (d.parentId === id) throw new BadRequestException('a category cannot be its own parent');
      if (!(await this.cats.byId(d.parentId))) throw new BadRequestException('parent not found');
      // moving under one of its own descendants would create a cycle
      const sub = await this.cats.subtreeIds(id);
      const all = await this.cats.all();
      const descendants = new Set(this.descendantIds(all, id));
      if (sub.includes(d.parentId) || descendants.has(d.parentId)) throw new BadRequestException('cannot move a category under its own descendant');
    }
    const row = await this.cats.update(id, d);
    if (d.isActive !== undefined || d.parentId !== undefined) await this.eligibility.recompute();
    return row;
  }

  private descendantIds(all: CategoryRow[], id: number): number[] {
    const out: number[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const c of all) if (c.parent_id === cur) { out.push(c.id); stack.push(c.id); }
    }
    return out;
  }

  async remove(id: number) {
    if (!(await this.cats.byId(id))) throw new NotFoundException();
    if ((await this.cats.childCount(id)) > 0) throw new ConflictException('category has children');
    if ((await this.cats.mappingCount(id)) > 0) throw new ConflictException('category still has store categories mapped to it; unmap them first');
    await this.cats.remove(id);
    return { deleted: true };
  }

  // ---------------------------------------------------------------- mapping

  async setMapping(sourceCategoryIds: number[], categoryId: number | null) {
    const ids = [...new Set(sourceCategoryIds)];
    if (!ids.length) throw new BadRequestException('no source categories given');
    if (categoryId !== null && !(await this.cats.byId(categoryId))) throw new BadRequestException('category not found');
    const found = await this.mapping.existing(ids);
    if (found.length !== ids.length) throw new BadRequestException('unknown source category id');
    await this.mapping.set(ids, categoryId);
    await this.eligibility.recompute(); // mapping changes can touch several shops
    return { updated: ids.length };
  }

  /** Unmapped (or all) store categories, each with a suggestion taken from an already-mapped category of the same name. */
  async sourceCategories(filter: { mapped?: boolean; shopId?: number; limit?: number; offset?: number }) {
    const rows = await this.mapping.list({ ...filter, limit: Math.min(500, filter.limit ?? 100), offset: filter.offset ?? 0 });
    const votes = new Map<string, Map<number, number>>();
    for (const m of await this.mapping.mappedNames()) {
      const key = normalizeFa(m.name);
      const v = votes.get(key) ?? new Map<number, number>();
      v.set(m.category_id, (v.get(m.category_id) ?? 0) + 1);
      votes.set(key, v);
    }
    return rows.map((r) => {
      let suggested: number | null = null;
      if (r.category_id === null) {
        const v = votes.get(normalizeFa(r.name));
        if (v) suggested = [...v.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
      return { ...r, suggestedCategoryId: suggested };
    });
  }

  unmappedProducts() {
    return this.mapping.unmappedProductCount();
  }
}
