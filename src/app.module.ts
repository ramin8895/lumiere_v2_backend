import { Module } from '@nestjs/common';
import { AdminController } from './admin/admin.controller';
import { CategoriesRepository } from './catalog/categories.repository';
import { CategoriesService } from './catalog/categories.service';
import { ListingsRepository } from './catalog/listings.repository';
import { MappingRepository } from './catalog/mapping.repository';
import { HmacGuard } from './common/hmac.guard';
import { DbModule } from './db/db.module';
import { EligibilityRepository } from './eligibility/eligibility.repository';
import { FeedClient } from './feed/feed.client';
import { GoController } from './go/go.controller';
import { GoService } from './go/go.service';
import { HealthController } from './health.controller';
import { PublicController } from './public/public.controller';
import { PublicRepository } from './public/public.repository';
import { PublicService } from './public/public.service';
import { ShopsRepository } from './shops/shops.repository';
import { SyncCompatController } from './sync/sync-compat.controller';
import { SyncService } from './sync/sync.service';

@Module({
  imports: [DbModule],
  controllers: [HealthController, PublicController, GoController, AdminController, SyncCompatController],
  providers: [
    HmacGuard, FeedClient, SyncService, ShopsRepository, ListingsRepository, CategoriesRepository, MappingRepository,
    CategoriesService, EligibilityRepository, PublicRepository, PublicService, GoService,
  ],
})
export class AppModule {}
