# lumiere_v2_backend (lumiere-api)

Marketplace backend for NexCart stores (products + stores only: no cart, no payments; the buy button goes to the seller's own site).
Pair repo: `lumiere_v2_front`. Plan lives in the Claude project "shop" (`plan-2026-11-07-marketplace.md`, `changes-2026-11-14-lumiere-phase1.md`).

- NestJS 10 + PostgreSQL via `pg`, SQL migrations in `migrations/` (forward only). No Prisma.
- Layering: controller → service → repository. Visibility rules live ONLY in `src/eligibility/eligibility.repository.ts` (SQL).
- Talks to nexcart-api with HMAC (`LUMIERE_SYNC_SECRET`, signature over `ts.METHOD.pathWithQuery`). Contract: `docs/FEED_CONTRACT.md`.
- `/api/go/:id` builds the redirect target from DB values only. Never accept a URL from the request.
- Store category names must never appear in public API responses.
- Brand name, domain, utm source are env; do not hardcode them.
- Tests: `npm test` needs Postgres (`TEST_DATABASE_URL`). Unused SQL parameters and `ORDER BY <const>` both broke queries here before: keep the e2e tests green.
- Persian user-facing text; code, identifiers, comments in English.
