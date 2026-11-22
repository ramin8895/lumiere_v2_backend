import { Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CategoriesService } from '../catalog/categories.service';
import { HmacGuard } from '../common/hmac.guard';
import { DbService } from '../db/db.service';
import { EligibilityRepository, shopHiddenReasons } from '../eligibility/eligibility.repository';
import { ShopsRepository } from '../shops/shops.repository';
import { SyncService } from '../sync/sync.service';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { BlockShopDto, CreateCategoryDto, SetMappingDto, UpdateCategoryDto } from './dto/admin.dto';

/** Called by nexcart-api (which authenticates the admin and writes the AuditLog). HMAC only, never browser-facing. */
@Controller('admin')
@UseGuards(HmacGuard)
export class AdminController {
  constructor(
    private readonly cats: CategoriesService,
    private readonly shops: ShopsRepository,
    private readonly eligibility: EligibilityRepository,
    private readonly sync: SyncService,
    private readonly db: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get('overview')
  async overview() {
    const row = await this.db.one<any>(
      `select (select count(*)::int from shop) as shops,
              (select count(*)::int from shop where eligible) as eligible_shops,
              (select count(*)::int from shop where eligible and reviewed_at is null) as unreviewed_shops,
              (select count(*)::int from catalog_product where status='ACTIVE' and offer_count>0) as visible_products,
              (select count(*)::int from listing where not deleted and not hidden_by_seller and category_id is null) as unmapped_products,
              (select count(*)::int from source_category sc where not exists (select 1 from category_mapping m where m.source_category_id = sc.id)) as unmapped_categories,
              (select count(*)::int from click_out where counted and created_at > now() - interval '7 days') as clicks_7d`);
    return row;
  }

  // ------------------------------------------------------------ categories
  @Get('categories') tree() { return this.cats.tree(false); }
  @Post('categories') create(@Body() d: CreateCategoryDto) { return this.cats.create(d); }
  @Patch('categories/:id') update(@Param('id', ParseIntPipe) id: number, @Body() d: UpdateCategoryDto) { return this.cats.update(id, d); }
  @Delete('categories/:id') remove(@Param('id', ParseIntPipe) id: number) { return this.cats.remove(id); }

  // --------------------------------------------------------------- mapping
  @Get('source-categories')
  sourceCategories(@Query('mapped') mapped?: string, @Query('shopId') shopId?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.cats.sourceCategories({
      mapped: mapped === 'true' ? true : mapped === 'false' ? false : undefined,
      shopId: shopId ? Number.parseInt(shopId, 10) || undefined : undefined,
      limit: Number.parseInt(limit ?? '100', 10) || 100,
      offset: Number.parseInt(offset ?? '0', 10) || 0,
    });
  }
  @Post('mappings') setMapping(@Body() d: SetMappingDto) { return this.cats.setMapping(d.sourceCategoryIds, d.categoryId); }

  // ----------------------------------------------------------------- shops
  @Get('shops')
  async listShops(@Query('unreviewed') unreviewed?: string) {
    const rows = await this.db.query<any>(
      `select id, source_id, slug, name, store_url, sync_enabled, tenant_active, subscription_active, blocked_by_admin, eligible,
              displayable_count, first_eligible_at, reviewed_at, last_sync_at, last_sync_error, last_sync_error_at
       from shop ${unreviewed === 'true' ? 'where eligible and reviewed_at is null' : ''} order by eligible desc, displayable_count desc, id`);
    return rows.map((r) => ({ ...r, hiddenReasons: shopHiddenReasons(r, this.cfg.minShopProducts) }));
  }

  @Patch('shops/:id')
  async blockShop(@Param('id', ParseIntPipe) id: number, @Body() d: BlockShopDto) {
    if (!(await this.shops.byId(id))) throw new NotFoundException();
    await this.db.query('update shop set blocked_by_admin = $2, updated_at = now() where id = $1', [id, d.blocked]);
    await this.eligibility.recompute(id);
    return this.shops.byId(id);
  }

  /** the "newly eligible" queue: admin looked at the shop */
  @Post('shops/:id/review')
  async review(@Param('id', ParseIntPipe) id: number) {
    await this.db.query('update shop set reviewed_at = now() where id = $1', [id]);
    return { reviewed: true };
  }

  // ------------------------------------------------------------------ sync
  @Get('sync/status')
  async syncStatus() {
    const errors = await this.db.query('select e.id, e.shop_id, s.name as shop_name, e.message, e.created_at from sync_error e left join shop s on s.id = e.shop_id order by e.id desc limit 50');
    const shops = await this.db.query(`select id, name, last_sync_at, last_full_sync_at, last_sync_error from shop where sync_enabled and tenant_active order by id`);
    return { shops, errors };
  }

  @Post('sync/run')
  run(@Query('full') full?: string) {
    void this.sync.syncAll({ full: full === 'true' });
    return { started: true };
  }
}
