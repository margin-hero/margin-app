-- Clear ALL data for the "Test Store" tenant, for a blank canvas before
-- re-importing test orders channel by channel.
--
-- Deletes (Test Store only):
--   order_line_items, cogs_components, shipping_rules, platform_listings,
--   master_products, tiktok_sku_catalog
--
-- Keeps:
--   tenants    - importers look up "Test Store" by name
--   platforms  - importers look up channels by name / integration_type
--
-- Affects every page. Dashboards (/grid, /channel-overview, /sku-detail,
-- /margins, /trends) and /products, /mappings, /tiktok-catalog will be empty
-- until data is re-imported.
--
-- After running: upload the TikTok catalog again before any TikTok import,
-- and add product costs + shipping rules (dated on or before your test orders).
--
-- HOW TO RUN: run step 1 on its own first and check the counts.
-- Then run step 2. Deleting can't be undone. If step 2 errors (e.g. another
-- table references these rows), nothing is deleted - send me the error.

-- Step 1: preview how many rows will be deleted from each table (read-only)
with t as (select id from tenants where name = 'Test Store'),
     mp as (select id from master_products where tenant_id in (select id from t)),
     pl as (select id from platform_listings where master_product_id in (select id from mp))
select 'order_line_items' as table_name, count(*) as rows_to_delete from order_line_items where platform_listing_id in (select id from pl)
union all select 'cogs_components', count(*) from cogs_components where master_product_id in (select id from mp)
union all select 'shipping_rules', count(*) from shipping_rules where master_product_id in (select id from mp)
union all select 'platform_listings', count(*) from pl
union all select 'master_products', count(*) from mp
union all select 'tiktok_sku_catalog', count(*) from tiktok_sku_catalog where tenant_id in (select id from t);

-- Step 2: delete everything, children first
begin;

delete from order_line_items
where platform_listing_id in (
  select pl.id from platform_listings pl
  join master_products mp on mp.id = pl.master_product_id
  join tenants t on t.id = mp.tenant_id
  where t.name = 'Test Store'
);

delete from cogs_components
where master_product_id in (
  select mp.id from master_products mp
  join tenants t on t.id = mp.tenant_id
  where t.name = 'Test Store'
);

delete from shipping_rules
where master_product_id in (
  select mp.id from master_products mp
  join tenants t on t.id = mp.tenant_id
  where t.name = 'Test Store'
);

delete from platform_listings
where master_product_id in (
  select mp.id from master_products mp
  join tenants t on t.id = mp.tenant_id
  where t.name = 'Test Store'
);

delete from master_products
where tenant_id in (select id from tenants where name = 'Test Store');

delete from tiktok_sku_catalog
where tenant_id in (select id from tenants where name = 'Test Store');

commit;
