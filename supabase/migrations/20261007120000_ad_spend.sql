-- Advertising spend per store SKU per day (Amazon Sponsored Products first).
--
-- 1. ad_spend: one row per store SKU (platform_listing_id) per day per ad type, as imported
--    on /amazon-ads-import. spend_pence is EX. VAT (as Amazon Ads reports it); vat_rate is the
--    VAT charged on top (20% for Amazon Ads UK). Re-uploading a day replaces that day's
--    figures (Amazon keeps updating attributed sales for a couple of weeks).
--    attributed_* = the sales Amazon credits to the ads (for ACOS), not extra revenue.
-- 2. ad_spend_lines (view): each row with its product and the cost to the business on that
--    day: ex. VAT for a VAT-registered store, inc. VAT for one that isn't (store_vat_status
--    on the spend date, like order_margins).
--
-- Ad spend is NOT in order_margins / margin_lines: like overheads, it's taken off at
-- reporting time (lib/adSpend.ts). No existing figure changes.
--
-- Pages affected: /amazon-ads-import (new), and the "after ads" figures on /margins,
-- /channel-overview and /sku-detail.

begin;

create table ad_spend (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references tenants(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  platform_listing_id uuid not null references platform_listings(id) on delete cascade,
  spend_date date not null,
  ad_type text not null default 'sponsored_products',
  spend_pence integer not null,
  vat_rate numeric not null default 0.2,
  attributed_sales_pence integer not null default 0,
  attributed_orders integer not null default 0,
  attributed_units integer not null default 0,
  source text not null default 'amazon_ads_report',
  imported_at timestamptz not null default now(),
  constraint ad_spend_listing_day_key unique (platform_listing_id, ad_type, spend_date)
);

create index ad_spend_store_date_idx on ad_spend (store_id, spend_date);

grant select, insert, update, delete on table ad_spend to authenticated;
alter table ad_spend enable row level security;
create policy tenant_isolation on ad_spend for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create view ad_spend_lines with (security_invoker = true) as
 SELECT a.id,
    a.store_id,
    a.platform_listing_id,
    pl.platform_sku,
    pl.master_product_id,
    mp.name AS product_name,
    mp.standard_sku,
    a.spend_date,
    a.ad_type,
    a.spend_pence,
    a.vat_rate,
    vat.registered AS vat_registered,
    -- The cost to the business: VAT on ad spend is reclaimable only when VAT registered
    CASE
        WHEN vat.registered THEN a.spend_pence
        ELSE round(a.spend_pence::numeric * (1 + a.vat_rate))::integer
    END AS cost_pence,
    a.attributed_sales_pence,
    a.attributed_orders,
    a.attributed_units
   FROM ad_spend a
     JOIN platform_listings pl ON pl.id = a.platform_listing_id
     JOIN master_products mp ON mp.id = pl.master_product_id
     JOIN stores s ON s.id = a.store_id
     -- VAT registration on the spend date (store_vat_status history; the store's current flag only as a fallback)
     LEFT JOIN LATERAL ( SELECT vs.vat_registered
           FROM store_vat_status vs
          WHERE vs.store_id = s.id AND vs.effective_from <= a.spend_date
          ORDER BY vs.effective_from DESC
         LIMIT 1) vs ON true
     CROSS JOIN LATERAL ( SELECT COALESCE(vs.vat_registered, s.vat_registered) AS registered) vat;

grant select on ad_spend_lines to authenticated;

commit;
