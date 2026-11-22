import { Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { HmacGuard } from '../common/hmac.guard';
import { DbService } from '../db/db.service';
import { ShopsRepository } from '../shops/shops.repository';
import { SyncService } from './sync.service';

/**
 * Endpoints the existing NexCart seller tab already calls (LumiereService.callLumiere).
 * Shapes match what LumiereTab.tsx reads: remote.{registered, indexedProducts, lastSyncAt}, analytics.{impressions, views, clicks, ctr}.
 */
@Controller('sync')
@UseGuards(HmacGuard)
export class SyncCompatController {
  constructor(private readonly sync: SyncService, private readonly shops: ShopsRepository, private readonly db: DbService) {}

  @Post('trigger/:tenantId')
  async trigger(@Param('tenantId') tenantId: string) {
    let shop = await this.shops.bySourceId(tenantId);
    if (!shop) {
      await this.sync.refreshMerchants();
      shop = await this.shops.bySourceId(tenantId);
    }
    if (!shop) return { started: false };
    void this.sync.syncShop(shop.id, { full: false });
    return { started: true };
  }

  @Post('refresh-merchants')
  async refresh() {
    void this.sync.refreshMerchants().catch(() => undefined);
    return { started: true };
  }

  @Get('status/:tenantId')
  async status(@Param('tenantId') tenantId: string) {
    const shop = await this.shops.bySourceId(tenantId);
    if (!shop) return { registered: false };
    return {
      registered: true,
      eligible: shop.eligible,
      indexedProducts: shop.displayable_count,
      lastSyncAt: shop.last_sync_at,
      lastSyncError: shop.last_sync_error,
    };
  }

  @Get('analytics/:tenantId')
  async analytics(@Param('tenantId') tenantId: string, @Query('days', new ParseIntPipe({ optional: true })) days = 30) {
    const shop = await this.shops.bySourceId(tenantId);
    if (!shop) return { registered: false };
    const window = Math.min(365, Math.max(1, days));
    const row = await this.db.one<{ clicks: number }>(
      `select count(*)::int as clicks from click_out where shop_id = $1 and counted and created_at > now() - ($2 || ' days')::interval`, [shop.id, String(window)]);
    // product-page views are not tracked in v1; impressions/views stay 0 instead of inventing numbers
    return { registered: true, impressions: 0, views: 0, clicks: row!.clicks, ctr: 0, aiRecommendations: 0 };
  }
}
