-- lumiere-api initial schema (phase 1: catalog, categories, mapping, sync, clicks)
create extension if not exists pg_trgm;

create table shop (
  id                   bigserial primary key,
  source               text not null default 'NEXCART',         -- NEXCART | API | WORDPRESS (later)
  source_id            text not null,                           -- NexCart tenantId
  name                 text not null,
  slug                 text not null unique,
  store_url            text not null,
  logo_url             text,
  description          text,
  city                 text,
  phone                text,
  show_phone           boolean not null default true,
  shipping_hours       integer,
  free_shipping_above  bigint,
  rating_avg           numeric(3,2) not null default 0,
  rating_count         integer not null default 0,
  excluded_category_ids text[] not null default '{}',
  -- state coming from the feed
  sync_enabled         boolean not null default false,          -- seller wants presence (default on) AND tenant ok
  tenant_active        boolean not null default false,
  subscription_active  boolean not null default true,           -- feed may omit it (older contract) -> true
  -- state owned by lumiere admin
  blocked_by_admin     boolean not null default false,
  -- computed
  displayable_count    integer not null default 0,
  eligible             boolean not null default false,
  first_eligible_at    timestamptz,
  reviewed_at          timestamptz,                             -- admin looked at a newly eligible shop
  -- sync bookkeeping
  last_sync_at         timestamptz,                             -- start time of last successful pass
  last_full_sync_at    timestamptz,
  last_sync_error      text,
  last_sync_error_at   timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (source, source_id)
);

create table source_category (
  id          bigserial primary key,
  shop_id     bigint not null references shop(id) on delete cascade,
  source_id   text not null,                 -- NexCart category id, or "path:<a/b>" when the feed has no ids
  name        text not null,
  path        text not null,                 -- "parent/child"
  created_at  timestamptz not null default now(),
  unique (shop_id, source_id)
);

create table category (
  id          bigserial primary key,
  parent_id   bigint references category(id) on delete restrict,
  name        text not null,
  slug        text not null unique,
  image_url   text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  meta_title  text,
  meta_description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index category_parent_idx on category(parent_id);

create table category_mapping (
  source_category_id bigint primary key references source_category(id) on delete cascade,
  category_id        bigint not null references category(id) on delete cascade,
  created_at         timestamptz not null default now()
);
create index category_mapping_category_idx on category_mapping(category_id);

create table catalog_product (
  id                 bigserial primary key,
  slug               text not null default 'product',
  title              text not null,
  brand              text,
  category_id        bigint references category(id) on delete set null,
  barcode            text,
  short_desc         text,
  images             jsonb not null default '[]',
  specs              jsonb not null default '[]',           -- [{name, value}]
  primary_listing_id bigint,
  status             text not null default 'ACTIVE',        -- ACTIVE | MERGED | HIDDEN
  merged_into_id     bigint references catalog_product(id),
  offer_count        integer not null default 0,
  price_min          bigint,
  price_max          bigint,
  in_stock           boolean not null default false,
  search_text        text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index catalog_product_category_idx on catalog_product(category_id) where status = 'ACTIVE' and offer_count > 0;
create index catalog_product_barcode_idx on catalog_product(barcode) where barcode is not null;
create index catalog_product_search_idx on catalog_product using gin (search_text gin_trgm_ops);
create index catalog_product_updated_idx on catalog_product(updated_at desc);

create table listing (
  id                  bigserial primary key,
  catalog_product_id  bigint not null references catalog_product(id),
  shop_id             bigint not null references shop(id) on delete cascade,
  source_product_id   text not null,
  source_slug         text not null,                          -- the store's own /product/<slug>
  source_category_id  bigint references source_category(id) on delete set null,
  category_id         bigint references category(id) on delete set null,  -- via mapping, denormalised
  title               text not null,
  brand               text,
  barcode             text,
  sku                 text,
  short_desc          text,
  price               bigint,                                 -- toman; null = price on request
  compare_at_price    bigint,
  available           boolean not null default false,
  stock               integer not null default 0,
  price_on_request    boolean not null default false,
  is_digital          boolean not null default false,
  custom_order        boolean not null default false,
  images              jsonb not null default '[]',
  specs               jsonb not null default '[]',
  variants            jsonb not null default '[]',            -- [{id,name,price,stock,options,imageUrl,sku}]
  hidden_by_seller    boolean not null default false,
  deleted             boolean not null default false,
  source_status       text,
  product_ok          boolean not null default false,         -- passes product rules (not shop rules)
  source_updated_at   timestamptz,
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (shop_id, source_product_id)
);
create index listing_catalog_idx on listing(catalog_product_id);
create index listing_shop_idx on listing(shop_id) where product_ok;
create index listing_source_category_idx on listing(source_category_id);

alter table catalog_product
  add constraint catalog_product_primary_listing_fk
  foreign key (primary_listing_id) references listing(id) deferrable initially deferred;

create table click_out (
  id          bigserial primary key,
  listing_id  bigint not null references listing(id),
  shop_id     bigint not null references shop(id),
  catalog_product_id bigint not null,
  ref         text,
  visitor_hash text not null,
  counted     boolean not null default true,                  -- false = duplicate or bot
  created_at  timestamptz not null default now()
);
create index click_out_shop_time_idx on click_out(shop_id, created_at desc);
create index click_out_dedupe_idx on click_out(visitor_hash, listing_id, created_at desc);

create table sync_error (
  id          bigserial primary key,
  shop_id     bigint references shop(id) on delete cascade,
  message     text not null,
  created_at  timestamptz not null default now()
);
create index sync_error_time_idx on sync_error(created_at desc);

create table slug_redirect (
  old_id      bigint primary key,
  new_id      bigint not null references catalog_product(id),
  created_at  timestamptz not null default now()
);
