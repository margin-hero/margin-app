-- Shipping profiles: courier price list + reusable "how a product ships" profiles.
--
--   courier_services          e.g. "Evri – Medium parcel (≤2kg)", with its VAT rate
--   courier_service_prices    dated prices per service (add a new row for a price rise)
--   shipping_profiles         e.g. "Large garden item"
--   shipping_profile_bands    qty range -> N parcels of a courier service
--                             (max_qty null = "and above"). Not dated (v1).
--   product_shipping_profiles which profile a product uses: store_id null = all stores,
--                             store_id set = override for that store. A store override
--                             with no profile means "no shipping cost" (e.g. FBA).
--
-- Shipping cost per order line, in order of priority:
--   1. real label cost from the channel (Amazon)
--   2. the product's own shipping_rules (unchanged, now an override)
--   3. the product's shipping profile (store override first, then all-stores)
--   4. nothing: £0 and flagged as missing
--
-- order_margins: same columns, same order, plus shipping_source at the end:
--   'label' | 'rule' | 'profile' | 'none' (deliberately no shipping) | 'missing'
-- Existing figures don't change: profiles only apply where nothing applied before.
--
-- Pages affected: every dashboard (/grid, /channel-overview, /sku-detail,
-- /margins, /trends), /costs, the missing-costs banner, /products/[id],
-- new /couriers and /shipping-profiles.
--
-- RLS reminder: like the other tables, these get a TEMPORARY allow-all policy
-- until Supabase Auth + real per-tenant RLS (roadmap: "Before real customers").
--
-- Runs in one transaction: if any step fails, nothing is changed.

begin;

-- 1. Tables ------------------------------------------------------------------

create table courier_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  vat_rate numeric not null check (vat_rate >= 0 and vat_rate < 1),
  created_at timestamptz not null default now(),
  constraint courier_services_tenant_name_key unique (tenant_id, name)
);

create table courier_service_prices (
  id uuid primary key default gen_random_uuid(),
  courier_service_id uuid not null references courier_services(id) on delete cascade,
  price_pence integer not null check (price_pence >= 0),
  effective_from date not null,
  created_at timestamptz not null default now(),
  constraint courier_service_prices_service_date_key unique (courier_service_id, effective_from)
);

create table shipping_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint shipping_profiles_tenant_name_key unique (tenant_id, name)
);

create table shipping_profile_bands (
  id uuid primary key default gen_random_uuid(),
  shipping_profile_id uuid not null references shipping_profiles(id) on delete cascade,
  min_qty integer not null check (min_qty >= 1),
  max_qty integer check (max_qty is null or max_qty >= min_qty),
  courier_service_id uuid not null references courier_services(id),
  parcels integer not null default 1 check (parcels >= 1),
  created_at timestamptz not null default now()
);

create table product_shipping_profiles (
  id uuid primary key default gen_random_uuid(),
  master_product_id uuid not null references master_products(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  shipping_profile_id uuid references shipping_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- "no profile" is only allowed as a store override (= no shipping cost in that store)
  constraint product_shipping_profiles_default_needs_profile check (shipping_profile_id is not null or store_id is not null),
  -- one default per product, and one override per product per store
  constraint product_shipping_profiles_product_store_key unique nulls not distinct (master_product_id, store_id)
);

-- 2. Access for the website (TEMPORARY until real RLS) ------------------------

grant select, insert, update, delete on table courier_services, courier_service_prices, shipping_profiles, shipping_profile_bands, product_shipping_profiles to anon, authenticated;

alter table courier_services enable row level security;
alter table courier_service_prices enable row level security;
alter table shipping_profiles enable row level security;
alter table shipping_profile_bands enable row level security;
alter table product_shipping_profiles enable row level security;

create policy "dev_allow_all_TEMPORARY" on courier_services for all to anon, authenticated using (true) with check (true);
create policy "dev_allow_all_TEMPORARY" on courier_service_prices for all to anon, authenticated using (true) with check (true);
create policy "dev_allow_all_TEMPORARY" on shipping_profiles for all to anon, authenticated using (true) with check (true);
create policy "dev_allow_all_TEMPORARY" on shipping_profile_bands for all to anon, authenticated using (true) with check (true);
create policy "dev_allow_all_TEMPORARY" on product_shipping_profiles for all to anon, authenticated using (true) with check (true);

-- 3. order_margins ------------------------------------------------------------
-- Same columns in the same order as before, with shipping_source added last.

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
    c.product_cost_pence,
    c.other_cost_pence,
    c.fees_pence,
    c.shipping_pence,
    (c.product_cost_pence + c.other_cost_pence + (c.fees_pence)::numeric + c.shipping_pence) AS total_cost_pence,
    ((revenue.revenue_pence)::numeric - (c.product_cost_pence + c.other_cost_pence + (c.fees_pence)::numeric + c.shipping_pence)) AS margin_pence,
    round(((((revenue.revenue_pence)::numeric - (c.product_cost_pence + c.other_cost_pence + (c.fees_pence)::numeric + c.shipping_pence)) / (NULLIF(revenue.revenue_pence, 0))::numeric) * (100)::numeric), 1) AS margin_percent,
    s.id AS store_id,
    plat.name AS platform_name,
    c.per_order_cost_pence,
    shipping.shipping_source
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
     -- Costs in effect on the order date: the latest row per (type, description),
     -- summed into landed / other per-unit / per-order, both inc. VAT (gross) and ex. VAT (net)
     LEFT JOIN LATERAL ( SELECT
            sum(CASE WHEN latest.in_gross THEN latest.amount_pence ELSE 0 END) AS landed_gross_pence,
            sum(CASE WHEN (NOT latest.in_gross AND latest.basis = 'per_unit') THEN latest.amount_pence ELSE 0 END) AS other_unit_gross_pence,
            sum(CASE WHEN latest.basis = 'per_order' THEN latest.amount_pence ELSE 0 END) AS per_order_gross_pence,
            sum(CASE WHEN latest.in_gross THEN latest.net_pence ELSE (0)::numeric END) AS landed_net_pence,
            sum(CASE WHEN (NOT latest.in_gross AND latest.basis = 'per_unit') THEN latest.net_pence ELSE (0)::numeric END) AS other_unit_net_pence,
            sum(CASE WHEN latest.basis = 'per_order' THEN latest.net_pence ELSE (0)::numeric END) AS per_order_net_pence
           FROM ( SELECT DISTINCT ON (cc.component_type, COALESCE(cc.description, ''))
                    cc.amount_pence,
                    ct.basis,
                    ct.in_gross,
                    round(((cc.amount_pence)::numeric - (((cc.amount_pence)::numeric * cc.vat_rate) / ((1)::numeric + cc.vat_rate)))) AS net_pence
                   FROM cogs_components cc
                     JOIN cost_types ct ON ct.code = cc.component_type
                  WHERE ((cc.master_product_id = mp.id) AND (cc.effective_from <= oli.order_date))
                  ORDER BY cc.component_type, COALESCE(cc.description, ''), cc.effective_from DESC) latest) cogs ON true
     -- Priority 2: the product's own shipping rule for this exact quantity
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
     -- Priority 3: which shipping profile applies (this store's override first, then all stores)
     LEFT JOIN LATERAL ( SELECT psp.shipping_profile_id
           FROM product_shipping_profiles psp
          WHERE ((psp.master_product_id = mp.id) AND (psp.store_id = s.id OR psp.store_id IS NULL))
          ORDER BY (psp.store_id IS NULL)
         LIMIT 1) assigned ON true
     -- ...and the band covering this quantity: N parcels x the courier price on the order date
     LEFT JOIN LATERAL ( SELECT (band.parcels * price.price_pence) AS cost_pence,
            cs.vat_rate
           FROM shipping_profile_bands band
             JOIN courier_services cs ON cs.id = band.courier_service_id
             CROSS JOIN LATERAL ( SELECT p.price_pence
                   FROM courier_service_prices p
                  WHERE ((p.courier_service_id = cs.id) AND (p.effective_from <= oli.order_date))
                  ORDER BY p.effective_from DESC
                 LIMIT 1) price
          WHERE ((band.shipping_profile_id = assigned.shipping_profile_id)
            AND ((oli.qty * pl.units_per_sale) >= band.min_qty)
            AND (band.max_qty IS NULL OR (oli.qty * pl.units_per_sale) <= band.max_qty))
          ORDER BY band.min_qty DESC
         LIMIT 1) prof ON true
     CROSS JOIN LATERAL ( SELECT
            COALESCE(oli.actual_shipping_cost_pence, sr.courier_cost_pence, prof.cost_pence) AS shipping_cost_gross_pence,
            CASE
                WHEN oli.actual_shipping_cost_pence IS NOT NULL OR sr.courier_cost_pence IS NOT NULL THEN COALESCE(sr.vat_rate, 0.20)
                ELSE COALESCE(prof.vat_rate, 0.20)
            END AS shipping_vat_rate,
            CASE
                WHEN oli.actual_shipping_cost_pence IS NOT NULL THEN 'label'
                WHEN sr.courier_cost_pence IS NOT NULL THEN 'rule'
                WHEN prof.cost_pence IS NOT NULL THEN 'profile'
                -- a store override with no profile = deliberately no shipping cost (e.g. FBA)
                WHEN EXISTS (SELECT 1 FROM product_shipping_profiles x
                             WHERE x.master_product_id = mp.id AND x.store_id = s.id AND x.shipping_profile_id IS NULL) THEN 'none'
                ELSE 'missing'
            END AS shipping_source) shipping
     -- Each cost bucket, net of VAT if the store is VAT registered, gross if not.
     -- Per-unit costs scale with effective quantity; per-order costs are charged once.
     CROSS JOIN LATERAL ( SELECT
            CASE
                WHEN s.vat_registered THEN (COALESCE(cogs.landed_net_pence, (0)::numeric) * ((oli.qty * pl.units_per_sale))::numeric)
                ELSE ((COALESCE(cogs.landed_gross_pence, (0)::bigint) * (oli.qty * pl.units_per_sale)))::numeric
            END AS product_cost_pence,
            CASE
                WHEN s.vat_registered THEN ((COALESCE(cogs.other_unit_net_pence, (0)::numeric) * ((oli.qty * pl.units_per_sale))::numeric) + COALESCE(cogs.per_order_net_pence, (0)::numeric))
                ELSE (((COALESCE(cogs.other_unit_gross_pence, (0)::bigint) * (oli.qty * pl.units_per_sale)) + COALESCE(cogs.per_order_gross_pence, (0)::bigint)))::numeric
            END AS other_cost_pence,
            CASE
                WHEN s.vat_registered THEN COALESCE(cogs.per_order_net_pence, (0)::numeric)
                ELSE (COALESCE(cogs.per_order_gross_pence, (0)::bigint))::numeric
            END AS per_order_cost_pence,
            CASE
                WHEN s.vat_registered THEN (oli.fees_gross_pence - oli.fees_vat_pence)
                ELSE oli.fees_gross_pence
            END AS fees_pence,
            CASE
                WHEN s.vat_registered THEN COALESCE(round(((shipping.shipping_cost_gross_pence)::numeric - (((shipping.shipping_cost_gross_pence)::numeric * shipping.shipping_vat_rate) / ((1)::numeric + shipping.shipping_vat_rate)))), (0)::numeric)
                ELSE (COALESCE(shipping.shipping_cost_gross_pence, 0))::numeric
            END AS shipping_pence) c;

commit;
