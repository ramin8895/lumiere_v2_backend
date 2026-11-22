# Deploy (same server as NexCart, user `nexcart`, PM2 + nginx)

Repos: `lumiere_v2_backend` (PM2 app `lumiere-api`, port 4100) and `lumiere_v2_front` (PM2 app `lumiere-web`, port 3003).

Never run git/npm as root inside `/var/www/nexcart`. Use the same `nx` helper as for NexCart.

## 1. Database (once, as postgres)
```
sudo -u postgres psql -c "create user lumiere with password 'CHANGE_ME'"
sudo -u postgres psql -c "create database lumiere owner lumiere"
sudo -u postgres psql lumiere -c "create extension if not exists pg_trgm"   # needs superuser; the migration also tries it
```
The marketplace DB is NOT rebuildable from the feed (categories, mappings, later: reviews, users, pins). Add it to `backup.sh`
(`pg_dump lumiere`) and to the offsite copy.

## 2. API
```
cd /var/www/lumiere/lumiere_v2_backend && npm ci && npm run build
cp .env.example .env   # fill DATABASE_URL, LUMIERE_SYNC_SECRET (same as nexcart-api), HASH_SALT, SITE_*
npm run migrate        # or AUTO_MIGRATE=true
```
`BIND_HOST=127.0.0.1` (loopback). The API must never be reachable from the internet; only lumiere-web and nexcart-api talk to it.

## 3. Web
```
cd /var/www/lumiere/lumiere_v2_front && npm ci && npm run build
cp .env.example .env.local
```
Do not add `output: 'standalone'` (PM2 + `next start`). Do not add `loading.tsx` to the product / category / shop routes:
with a Suspense boundary Next answers 200 for missing pages and soft-redirects instead of 404 / 308 (verified).
`SITE_NAME` / `SITE_URL` are read at runtime: renaming or moving the domain is an env change + `pm2 reload`.

## 4. PM2 (add to /home/nexcart/ecosystem.config.js)
```js
{ name: 'lumiere-api', cwd: '/var/www/lumiere/lumiere_v2_backend', script: 'dist/main.js', max_memory_restart: '300M',
  env: { NODE_ENV: 'production' } },
{ name: 'lumiere-web', cwd: '/var/www/lumiere/lumiere_v2_front', script: 'node_modules/next/dist/bin/next',
  args: 'start -p 3003 -H 127.0.0.1', max_memory_restart: '400M', env: { NODE_ENV: 'production' } },
```
Load the `.env` files (`node --env-file=.env` or PM2 `env_file`/dotenv) so secrets are not in the ecosystem file.

## 5. nginx
```nginx
server {
  listen 443 ssl http2;
  server_name lumiere.nexcart.ir;        # exact name wins over *.nexcart.ir; later: the new domain
  # ssl_certificate ... (the wildcard cert covers *.nexcart.ir; a new domain needs its own cert)

  location / {
    proxy_pass http://127.0.0.1:3003;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, do not append client-supplied values
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  # rate limit the buy button and search more strictly than pages
  location /go/    { limit_req zone=lumiere_go burst=20 nodelay;     proxy_pass http://127.0.0.1:3003; proxy_set_header X-Real-IP $remote_addr; }
  location /search { limit_req zone=lumiere_search burst=10 nodelay; proxy_pass http://127.0.0.1:3003; proxy_set_header X-Real-IP $remote_addr; }
}
# http {} level:  limit_req_zone $binary_remote_addr zone=lumiere_go:10m rate=5r/s;
#                 limit_req_zone $binary_remote_addr zone=lumiere_search:10m rate=3r/s;
```
Add `lumiere` to `RESERVED_SUBDOMAINS` in NexCart's `tenants.service.ts` while the site lives on a nexcart.ir subdomain,
and check `select id from "Tenant" where subdomain = 'lumiere'` returns nothing.

## 6. NexCart side
Set `LUMIERE_API_URL=http://127.0.0.1:4100/api` (same server) and keep `LUMIERE_SYNC_SECRET` identical in both apps.
The feed changes in `FEED_CONTRACT.md` are required before launch (default-on + eligibility need them).

## 7. Moving to a separate server later
Env only: `NEXCART_FEED_URL=https://api.nexcart.ir/api/lumiere/sync`, `LUMIERE_API_URL=https://<new-api-host>/api` in nexcart-api,
`pg_dump | pg_restore`, nginx IP allowlist for `/api/lumiere/sync/` on the NexCart server. Test the signature over HTTPS once.

## 8. First-day checklist
1. `curl -s localhost:4100/api/health`
2. Admin: create categories (`POST /api/admin/categories`) and map store categories (`POST /api/admin/mappings`) until `overview.unmapped_products` is ~0.
3. `free -h`, `vmstat 5 5` (column `wa`), `pm2 monit` while the first full sync runs.
