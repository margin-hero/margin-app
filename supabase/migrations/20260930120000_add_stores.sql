-- Adds "stores": a tenant can now run several stores on the same platform
-- (e.g. three TikTok shops for different brands, or Amazon UK + Amazon FR).
--
--   tenants ──< stores >── platforms
--                 │
--                 └──< platform_listings ──< order_line_items
--
-- * VAT registration moves from the tenant to the store (a new brand may be a
--   separate, not-yet-registered entity). tenants.vat_registered is left in
--   place but no longer used by the views.
-- * Shipping rules can optionally be tied to one store. A rule with no store is
--   the product's default and applies to every store without its own rule.
-- * TikTok's SKU ID catalog is per store (each shop has its own IDs).
-- * order_margins.channel now shows the STORE name, so dashboards group by
--   store automatically. Existing stores are named after their platform, so
--   nothing looks different until you add a second store.
--
-- Pages affected: /grid, /channel-overview, /sku-detail, /margins, /trends
-- (via the views), plus every importer, /mappings, /products/[id], /tiktok-catalog.
--
-- Everything runs in one transaction: if any step fails, nothing is changed.

begin;

-- 1. The stores table ---------------------------------------------------------

create table stores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  platform_id uuid not null references platforms(id),
  name text not null,
  vat_registered boolean not null,
  created_at timestamptz not null default now(),
  constraint stores_tenant_name_key unique (tenant_id, name)
);

-- One store for every tenant + platform combination already in use, named after
-- the platform and copying the tenant's current VAT setting.
insert into stores (tenant_id, platform_id, name, vat_registered)
select distinct mp.tenant_id, pl.platform_id, p.name, t.vat_registered
from platform_listings pl
join master_products mp on mp.id = pl.master_product_id
join platforms p on p.id = pl.platform_id
join tenants t on t.id = mp.tenant_id;

-- A TikTok store for any tenant with a saved TikTok catalog but no TikTok listings yet.
insert into stores (tenant_id, platform_id, name, vat_registered)
select distinct c.tenant_id, p.id, p.name, t.vat_registered
from tiktok_sku_catalog c
join tenants t on t.id = c.tenant_id
cross join platforms p
where p.name = 'TikTok'
on conflict (tenant_id, name) do nothing;

-- 2. Listings belong to a store -----------------------------------------------

alter table platform_listings add column store_id uuid references stores(id);

update platform_listings pl
set store_id = s.id
from master_products mp, stores s
where mp.id = pl.master_product_id
  and s.tenant_id = mp.tenant_id
  and s.platform_id = pl.platform_id;

alter table platform_listings alter column store_id set not null;

-- platform_id is kept (other queries use it) but is now always copied from the
-- store automatically, so the two can never disagree.
create function platform_listings_sync_platform() returns trigger
language plpgsql as $$
begin
  select platform_id into new.platform_id from stores where id = new.store_id;
  return new;
end;
$$;

create trigger platform_listings_sync_platform
before insert or update of store_id, platform_id on platform_listings
for each row execute function platform_listings_sync_platform();

-- 3. TikTok catalog is per store ----------------------------------------------

alter table tiktok_sku_catalog add column store_id uuid references stores(id) on delete cascade;

update tiktok_sku_catalog c
set store_id = s.id
from stores s
join platforms p on p.id = s.platform_id
where s.tenant_id = c.tenant_id
  and p.name = 'TikTok';

alter table tiktok_sku_catalog alter column store_id set not null;

-- 4. Shipping rules can optionally be store-specific --------------------------

alter table shipping_rules add column store_id uuid references stores(id) on delete cascade;

-- 5. Swap the old per-platform / per-tenant uniqueness for per-store ----------
-- The existing unique constraint names aren't known, so find them by their columns.

do $$
declare
  target record;
  idx record;
begin
  for target in
    select * from (values
      ('platform_listings'::regclass,  array['platform_id','platform_sku']),
      ('tiktok_sku_catalog'::regclass, array['sku_id','tenant_id'])
    ) as v(tbl, cols)
  loop
    for idx in
      select i.indexrelid, c.conname
      from pg_index i
      left join pg_constraint c on c.conindid = i.indexrelid and c.conrelid = i.indrelid
      where i.indrelid = target.tbl
        and i.indisunique
        and not i.indisprimary
        and (select array_agg(a.attname::text order by a.attname)
             from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = target.cols
    loop
      if idx.conname is not null then
        execute format('alter table %s drop constraint %I', target.tbl, idx.conname);
      else
        execute format('drop index %s', idx.indexrelid::regclass);
      end if;
    end loop;
  end loop;
end;
$$;

alter table platform_listings
  add constraint platform_listings_store_sku_key unique (store_id, platform_sku);

alter table tiktok_sku_catalog
  add constraint tiktok_sku_catalog_store_sku_key unique (store_id, sku_id);

-- 6. order_margins: VAT mode from the store, channel = store name, -----------
--    store-specific shipping rules win over the product default.
-- Same columns in the same order as before (so sku_channel_margins keeps
-- working), with store_id and platform_name added at the end.

create or replace view order_margins as
 SELECT oli.id AS order_line_item_id,
    mp.id AS master_product_id,
    mp.name AS product_name,
    s.name AS channel,
    s.vat_registered,
    oli.order_date,
    oli.qty,
    pl.units_per_sale,
    (oli.qty * pl.units_per_sale) AS effective_qty,
    oli.sale_price_gross_pence AS sale_price_pence,
    round(((oli.sale_price_gross_pence)::numeric / ((oli.qty * pl.units_per_sale))::numeric), 2) AS price_per_unit_pence,
    oli.service_level,
    revenue.revenue_pence,
        CASE
            WHEN s.vat_registered THEN (COALESCE(cogs.cost_price_net_pence, (0)::numeric) * ((oli.qty * pl.units_per_sale))::numeric)
            ELSE ((COALESCE(cogs.cost_price_gross_pence, (0)::bigint) * (oli.qty * pl.units_per_sale)))::numeric
        END AS product_cost_pence,
        CASE
            WHEN s.vat_registered THEN (COALESCE(cogs.other_net_pence, (0)::numeric) * ((oli.qty * pl.units_per_sale))::numeric)
            ELSE ((COALESCE(cogs.other_gross_pence, (0)::bigint) * (oli.qty * pl.units_per_sale)))::numeric
        END AS other_cost_pence,
        CASE
            WHEN s.vat_registered THEN (oli.fees_gross_pence - oli.fees_vat_pence)
            ELSE oli.fees_gross_pence
        END AS fees_pence,
        CASE
            WHEN s.vat_registered THEN COALESCE(round(((shipping.shipping_cost_gross_pence)::numeric - (((shipping.shipping_cost_gross_pence)::numeric * shipping.shipping_vat_rate) / ((1)::numeric + shipping.shipping_vat_rate)))), (0)::numeric)
            ELSE (COALESCE(shipping.shipping_cost_gross_pence, 0))::numeric
        END AS shipping_pence,
    costs.total_cost_pence,
    ((revenue.revenue_pence)::numeric - costs.total_cost_pence) AS margin_pence,
    round(((((revenue.revenue_pence)::numeric - costs.total_cost_pence) / (NULLIF(revenue.revenue_pence, 0))::numeric) * (100)::numeric), 1) AS margin_percent,
    s.id AS store_id,
    plat.name AS platform_name
   FROM order_line_items oli
     JOIN platform_listings pl ON pl.id = oli.platform_listing_id
     JOIN master_products mp ON mp.id = pl.master_product_id
     JOIN stores s ON s.id = pl.store_id
     JOIN platforms plat ON plat.id = s.platform_id
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN s.vat_registered THEN ((oli.sale_price_gross_pence - oli.sale_vat_pence) + (oli.shipping_revenue_gross_pence - oli.shipping_revenue_vat_pence))
                    ELSE (oli.sale_price_gross_pence + oli.shipping_revenue_gross_pence)
                END AS revenue_pence) revenue
     LEFT JOIN LATERAL ( SELECT sum(
                CASE
                    WHEN (latest_per_type.component_type = 'cost_price'::text) THEN latest_per_type.amount_pence
                    ELSE 0
                END) AS cost_price_gross_pence,
            sum(
                CASE
                    WHEN (latest_per_type.component_type <> 'cost_price'::text) THEN latest_per_type.amount_pence
                    ELSE 0
                END) AS other_gross_pence,
            sum(
                CASE
                    WHEN (latest_per_type.component_type = 'cost_price'::text) THEN round(((latest_per_type.amount_pence)::numeric - (((latest_per_type.amount_pence)::numeric * latest_per_type.vat_rate) / ((1)::numeric + latest_per_type.vat_rate))))
                    ELSE (0)::numeric
                END) AS cost_price_net_pence,
            sum(
                CASE
                    WHEN (latest_per_type.component_type <> 'cost_price'::text) THEN round(((latest_per_type.amount_pence)::numeric - (((latest_per_type.amount_pence)::numeric * latest_per_type.vat_rate) / ((1)::numeric + latest_per_type.vat_rate))))
                    ELSE (0)::numeric
                END) AS other_net_pence
           FROM ( SELECT DISTINCT ON (cogs_components.component_type) cogs_components.component_type,
                    cogs_components.amount_pence,
                    cogs_components.vat_rate
                   FROM cogs_components
                  WHERE ((cogs_components.master_product_id = mp.id) AND (cogs_components.effective_from <= oli.order_date))
                  ORDER BY cogs_components.component_type, cogs_components.effective_from DESC) latest_per_type) cogs ON true
     LEFT JOIN LATERAL ( SELECT shipping_rules.courier_cost_pence,
            shipping_rules.vat_rate
           FROM shipping_rules
          WHERE ((shipping_rules.master_product_id = mp.id)
            AND (shipping_rules.store_id = s.id OR shipping_rules.store_id IS NULL)
            AND (shipping_rules.qty = (oli.qty * pl.units_per_sale))
            AND (shipping_rules.service_level = oli.service_level)
            AND (shipping_rules.effective_from <= oli.order_date))
          -- store-specific rule first (false sorts before true), then most recent
          ORDER BY (shipping_rules.store_id IS NULL), shipping_rules.effective_from DESC
         LIMIT 1) sr ON true
     CROSS JOIN LATERAL ( SELECT COALESCE(oli.actual_shipping_cost_pence, sr.courier_cost_pence) AS shipping_cost_gross_pence,
            COALESCE(sr.vat_rate, 0.20) AS shipping_vat_rate) shipping
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN s.vat_registered THEN ((((oli.fees_gross_pence - oli.fees_vat_pence))::numeric + ((COALESCE(cogs.cost_price_net_pence, (0)::numeric) + COALESCE(cogs.other_net_pence, (0)::numeric)) * ((oli.qty * pl.units_per_sale))::numeric)) + COALESCE(round(((shipping.shipping_cost_gross_pence)::numeric - (((shipping.shipping_cost_gross_pence)::numeric * shipping.shipping_vat_rate) / ((1)::numeric + shipping.shipping_vat_rate)))), (0)::numeric))
                    ELSE (((oli.fees_gross_pence + ((COALESCE(cogs.cost_price_gross_pence, (0)::bigint) + COALESCE(cogs.other_gross_pence, (0)::bigint)) * (oli.qty * pl.units_per_sale))) + COALESCE(shipping.shipping_cost_gross_pence, 0)))::numeric
                END AS total_cost_pence) costs;

commit;
