import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PublicService } from './public.service';
import { PageQuery, ProductListQuery, SuggestQuery } from './dto/query.dto';

/** Read-only API used by lumiere-web (server side). Bind lumiere-api to loopback so only the web app can reach it. */
@Controller('public')
export class PublicController {
  constructor(private readonly svc: PublicService) {}

  @Get('categories') categories() { return this.svc.categories(); }

  @Get('categories/:slug')
  category(@Param('slug') slug: string, @Query() q: ProductListQuery) { return this.svc.category(slug, q); }

  @Get('products') products(@Query() q: ProductListQuery) { return this.svc.listProducts(q); }

  @Get('products/:id') product(@Param('id', ParseIntPipe) id: number) { return this.svc.product(id); }

  @Get('suggest') suggest(@Query() q: SuggestQuery) { return this.svc.suggest(q.q); }

  @Get('shops') shops(@Query() q: PageQuery) { return this.svc.shops(q.page, q.pageSize); }

  @Get('shops/:slug') shop(@Param('slug') slug: string, @Query() q: PageQuery) { return this.svc.shop(slug, q.page, q.pageSize); }

  @Get('sitemap/products') sitemap(@Query() q: PageQuery) { return this.svc.sitemap(q.page); }
}
