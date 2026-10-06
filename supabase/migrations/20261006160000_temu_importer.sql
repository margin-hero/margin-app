-- Temu gets its own importer (/temu-import), and TikTok's SKU ID list becomes a list
-- for any channel whose reports use the channel's own SKU ID instead of yours.
--
-- 1. tiktok_sku_catalog is renamed channel_sku_ids. Same columns (store_id, sku_id,
--    seller_sku, tenant_id), same rows, same security policy and permissions (they move
--    with the table). Used for TikTok and now Temu stores: each listing in those stores
--    has the channel's SKU ID, and importers translate it back to your SKU.
-- 2. Temu: integration_type 'temu' (the importer finds its stores by it). Added as a
--    platform if it doesn't exist yet.
--
-- Safe to run twice. Existing stores, listings and orders are untouched.
--
-- Pages affected: /mappings (Store SKUs), /products/[id], /catalog-import, /tiktok-import
-- and the TikTok catalog upload all use the new table name (in the same code change, so
-- run this before the code goes live). /temu-import and /stores (platform dropdown).

begin;

do $$
begin
  if to_regclass('public.tiktok_sku_catalog') is not null and to_regclass('public.channel_sku_ids') is null then
    alter table public.tiktok_sku_catalog rename to channel_sku_ids;
  end if;
end $$;

update platforms
set integration_type = 'temu'
where lower(name) = 'temu';

insert into platforms (name, integration_type, country_code, currency_code)
select 'Temu', 'temu', 'GB', 'GBP'
where not exists (select 1 from platforms p where lower(p.name) = 'temu');

commit;

-- Should show: channel_sku_ids, and one row Temu / temu
select to_regclass('public.channel_sku_ids') as sku_id_table;
select name, integration_type from platforms where integration_type = 'temu';
