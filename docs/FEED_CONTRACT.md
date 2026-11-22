# Feed contract (nexcart-api → lumiere-api)

lumiere-api **pulls**. It reuses the HMAC feed that already exists in NexCart (`modules/lumiere/lumiere-sync.controller.ts`).
Nothing here needs a new endpoint; the work on the NexCart side is to fix and extend what that feed returns.

## Transport (unchanged)
- `GET {NEXCART_FEED_URL}/merchants`
- `GET {NEXCART_FEED_URL}/products?tenantId=&since=&cursor=&limit=`
- Headers `x-lumiere-timestamp` (ms) and `x-lumiere-signature` = hex HMAC-SHA256 of `"{timestamp}.{METHOD}.{path+query}"`
  with `LUMIERE_SYNC_SECRET`. 5 minute skew. The signed path is the exact path+query that is sent
  (`/api/lumiere/sync/products?tenantId=...`). lumiere-api builds it from the URL it calls, so it also works over HTTPS later.
- lumiere-api → NexCart seller-tab calls (`/api/sync/trigger|status|analytics|refresh-merchants`) use the same scheme and are implemented
  in `src/sync/sync-compat.controller.ts` with the response shapes `LumiereTab.tsx` reads.

## What lumiere-api already tolerates (all "v2" fields are optional)
lumiere-api works against **today's** feed. Missing v2 fields fall back safely (see `src/sync/feed-mapper.ts`).

### merchants[]
| field | today | needed change |
|---|---|---|
| `syncEnabled` | `config.enabled === true && integration CONNECTED && tenant ACTIVE` → **default OFF** | `config.enabled !== false && tenant ACTIVE` (default ON; explicit `enabled:false` stays off) |
| (rows) | only tenants that have an `Integration(LUMIERE)` row | return **all** tenants |
| `storeUrl` | first VERIFIED domain, no ordering, no SSL check | use `resolveStoreBaseUrl()` (VERIFIED + ISSUED, oldest first) |
| `subscriptionActive` (v2) | missing | `subscription.status === ACTIVE && expiresAt > now` |
| `showPhone` (v2) | phone always sent | add setting, default true |
| rating | one query per merchant (N+1) | single `groupBy` |
| controller | `@Public()` but throttled (120/min/IP) | add `@SkipThrottle()` (HMAC protects it) |

### products[]
| field | today | needed change |
|---|---|---|
| `price` | `Number(product.price)` (ignores sale events) | use `PricingService` like `TorobCatalogService` (what the store shows) |
| `compareAtPrice` | raw | from `PricingService.unit().compareAtPrice` |
| `barcode` / `gtin` | `gtin: null` | new `Product.barcode` column; send in both |
| `categoryId` (v2) | missing (name path only) | product's category id |
| `categoryChainIds` (v2) | missing | `[own id, parent id, ...]` so hiding a parent category hides sub-categories |
| `priceOnRequest`, `isDigital`, `customOrder` (v2) | missing | send the product flags |
| `variants[].id`, `.sku`, `.imageUrl` (v2) | missing | send (needed for `?variant=<id>` deep links) |
| `hidden` | only product's own category checked | keep, lumiere-api also checks `categoryChainIds` against `excludedCategoryIds` |
| freshness | sale start/end does not change `updatedAt` | cron (every 5 min) touches `updatedAt` of products in campaigns that just started/ended |

## Behaviour guarantees on the lumiere-api side
- An **empty** `merchants` list never switches shops off (treated as an outage).
- A failed page keeps the previous data and records a `sync_error`.
- Hourly full pass: products not seen in a completed full pass are soft-deleted.
- Only `status === ACTIVE`, not deleted, not hidden, with an image and a mapped category are shown; a shop needs `MIN_SHOP_PRODUCTS` (3).
