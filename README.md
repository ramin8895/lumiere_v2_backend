# lumiere-api

Marketplace backend (shows products and stores of NexCart shops; no cart, no payments; the buy button goes to the seller's site).
NestJS 10 + PostgreSQL (`pg`, plain SQL migrations). Public site: the sibling repo `lumiere_v2_front` (`lumiere-web`).

```
npm ci
cp .env.example .env
npm run build && npm run migrate && npm start
npm test            # needs a Postgres: TEST_DATABASE_URL (default postgresql://lumiere:lumiere@127.0.0.1:55432/lumiere_test)
```

| area | files |
|---|---|
| feed pull (HMAC) | `src/feed/*`, `src/sync/sync.service.ts`, `src/sync/feed-mapper.ts` |
| visibility rules (one place, SQL) | `src/eligibility/eligibility.repository.ts` |
| our categories + mapping | `src/catalog/categories.*`, `mapping.repository.ts` |
| public read API (used by lumiere-web) | `src/public/*` |
| buy button `/api/go/:listingId` | `src/go/*` |
| admin API (HMAC, called by nexcart-api) | `src/admin/*` |
| seller-tab compatibility | `src/sync/sync-compat.controller.ts` |

Why not Prisma: the NexCart stack uses it, but this project's sandbox could not download Prisma's engines, and the search/eligibility
queries are raw SQL anyway. Plain SQL migrations (`migrations/NNNN_name.sql`, forward only) are applied by `src/db/migrator.ts`.

Design rules that must not be broken
- The redirect target of `/go` is built from database values only (open-redirect safe); `variant` must be one of the listing's own variant ids.
- Store category names are never returned by the public API; only our own category tree is.
- Visibility is computed in SQL in one place (`EligibilityRepository.recompute`); change rules there and in `shopHiddenReasons` together.
- Brand name, domain and utm source come from env (`SITE_NAME`, `SITE_URL`, `UTM_SOURCE`); never hardcode "lumiere" in outputs.

## Dev demo (never against production)
`DATABASE_URL=... LUMIERE_SYNC_SECRET=<24+ chars> HASH_SALT=x npm run demo` fills the database with demo shops and products through the signed mock feed
and keeps demo images on :4778. Then `npm run build && npm start` and point `lumiere_v2_front` at it. (It compiles with `tsc`; `tsx` does not emit decorator metadata and breaks Nest DI.)
