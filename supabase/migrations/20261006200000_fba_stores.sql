-- Amazon FBA support (FBA is its own store), part 1: the database.
--
-- 1. stores.fulfilled_by_channel: the channel ships the orders (e.g. Amazon FBA), so the
--    seller has no shipping cost of their own there (shipping_source 'none', never 'missing').
--    The channel's fulfilment fee is already in the order's fees.
-- 2. cogs_components.store_id: a cost can apply to one store only (e.g. FBA prep, labelling,
--    inbound freight to Amazon). null = all stores (every existing cost). For the same cost
--    type + description, a store's own cost wins over the all-stores one.
-- 3. order_margins and margin_lines re-created from 20261006180000_dated_vat_registration.sql
--    with only those two changes. No store is channel-fulfilled and no cost is store-specific
--    yet, so no figure changes: checked line by line before committing (cancels if not).
--
-- Pages affected: every dashboard, Cost Check, the missing-costs banner, /order-lines,
-- /stores (new setting), /products/[id] (store choice on costs).
--
-- Runs in one transaction: if any step fails, nothing is changed.

begin;

create temp table margin_lines_before on commit drop as
  select order_line_item_id, line_type, revenue_pence, product_cost_pence, total_cost_pence, margin_pence, shipping_pence
  from margin_lines;

alter table stores add column if not exists fulfilled_by_channel boolean not null default false;

alter table cogs_components add column if not exists store_id uuid references stores(id) on delete cascade;
create index if not exists cogs_components_store_id_idx on cogs_components (store_id);

create or replace view order_margins with (security_invoker = true) as
 SELECT oli.id AS order_line_item_id,
    mp.id AS master_product_id,
    mp.name AS product_name,
    s.name AS channel,
    vat.registered AS vat_registered,
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
     -- VAT registration on the order date (store_vat_status history; the store's current flag only as a fallback)
     LEFT JOIN LATERAL ( SELECT vs.vat_registered
           FROM store_vat_status vs
          WHERE vs.store_id = s.id AND vs.effective_from <= oli.order_date
          ORDER BY vs.effective_from DESC
         LIMIT 1) vs ON true
     CROSS JOIN LATERAL ( SELECT COALESCE(vs.vat_registered, s.vat_registered) AS registered) vat
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN vat.registered THEN ((oli.sale_price_gross_pence - oli.sale_vat_pence) + (oli.shipping_revenue_gross_pence - oli.shipping_revenue_vat_pence))
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
                  WHERE ((cc.master_product_id = mp.id) AND (cc.effective_from <= oli.order_date)
                    AND (cc.store_id IS NULL OR cc.store_id = s.id))
                  -- this store's own cost first (false sorts before true), then the most recent
                  ORDER BY cc.component_type, COALESCE(cc.description, ''), (cc.store_id IS NULL), cc.effective_from DESC) latest) cogs ON true
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
            -- a store fulfilled by the channel (e.g. Amazon FBA) has no shipping cost of its own: the channel's fee covers it
            COALESCE(oli.actual_shipping_cost_pence, CASE WHEN s.fulfilled_by_channel THEN 0 END, sr.courier_cost_pence, prof.cost_pence) AS shipping_cost_gross_pence,
            CASE
                WHEN oli.actual_shipping_cost_pence IS NOT NULL OR sr.courier_cost_pence IS NOT NULL THEN COALESCE(sr.vat_rate, 0.20)
                ELSE COALESCE(prof.vat_rate, 0.20)
            END AS shipping_vat_rate,
            CASE
                WHEN oli.actual_shipping_cost_pence IS NOT NULL THEN 'label'
                WHEN s.fulfilled_by_channel THEN 'none'
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
                WHEN vat.registered THEN (COALESCE(cogs.landed_net_pence, (0)::numeric) * ((oli.qty * pl.units_per_sale))::numeric)
                ELSE ((COALESCE(cogs.landed_gross_pence, (0)::bigint) * (oli.qty * pl.units_per_sale)))::numeric
            END AS product_cost_pence,
            CASE
                WHEN vat.registered THEN ((COALESCE(cogs.other_unit_net_pence, (0)::numeric) * ((oli.qty * pl.units_per_sale))::numeric) + COALESCE(cogs.per_order_net_pence, (0)::numeric))
                ELSE (((COALESCE(cogs.other_unit_gross_pence, (0)::bigint) * (oli.qty * pl.units_per_sale)) + COALESCE(cogs.per_order_gross_pence, (0)::bigint)))::numeric
            END AS other_cost_pence,
            CASE
                WHEN vat.registered THEN COALESCE(cogs.per_order_net_pence, (0)::numeric)
                ELSE (COALESCE(cogs.per_order_gross_pence, (0)::bigint))::numeric
            END AS per_order_cost_pence,
            CASE
                WHEN vat.registered THEN (oli.fees_gross_pence - oli.fees_vat_pence)
                ELSE oli.fees_gross_pence
            END AS fees_pence,
            CASE
                WHEN vat.registered THEN COALESCE(round(((shipping.shipping_cost_gross_pence)::numeric - (((shipping.shipping_cost_gross_pence)::numeric * shipping.shipping_vat_rate) / ((1)::numeric + shipping.shipping_vat_rate)))), (0)::numeric)
                ELSE (COALESCE(shipping.shipping_cost_gross_pence, 0))::numeric
            END AS shipping_pence) c;

create or replace view margin_lines with (security_invoker = true) as
 SELECT om.order_line_item_id,
    om.master_product_id,
    om.product_name,
    om.channel,
    om.vat_registered,
    om.order_date,
    om.qty,
    om.units_per_sale,
    om.effective_qty,
    om.sale_price_pence,
    om.price_per_unit_pence,
    om.service_level,
    (om.revenue_pence)::numeric AS revenue_pence,
    om.product_cost_pence,
    om.other_cost_pence,
    (om.fees_pence)::numeric AS fees_pence,
    om.shipping_pence,
    om.total_cost_pence,
    om.margin_pence,
    om.margin_percent,
    om.store_id,
    om.platform_name,
    om.per_order_cost_pence,
    om.shipping_source,
    'sale'::text AS line_type,
    0 AS refunded_units,
    (oli.sale_price_gross_pence + COALESCE(oli.shipping_revenue_gross_pence, 0)) AS gross_sales_pence
   FROM order_margins om
     JOIN order_line_items oli ON oli.id = om.order_line_item_id
UNION ALL
 SELECT r.id AS order_line_item_id,
    mp.id AS master_product_id,
    mp.name AS product_name,
    s.name AS channel,
    vat.registered AS vat_registered,
    r.refund_date AS order_date,
    -units.qty AS qty,
    pl.units_per_sale,
    -(units.qty * pl.units_per_sale) AS effective_qty,
    -r.refund_gross_pence AS sale_price_pence,
    NULL::numeric AS price_per_unit_pence,
    orig.service_level,
    -rev.revenue_pence AS revenue_pence,
    c.product_cost_pence,
    0::numeric AS other_cost_pence,
    c.fees_pence,
    c.shipping_pence,
    (c.product_cost_pence + c.fees_pence + c.shipping_pence) AS total_cost_pence,
    (-rev.revenue_pence - (c.product_cost_pence + c.fees_pence + c.shipping_pence)) AS margin_pence,
    NULL::numeric AS margin_percent,
    s.id AS store_id,
    plat.name AS platform_name,
    0::numeric AS per_order_cost_pence,
    NULL::text AS shipping_source,
    'refund'::text AS line_type,
    (units.qty * pl.units_per_sale) AS refunded_units,
    -(r.refund_gross_pence + r.shipping_refund_gross_pence) AS gross_sales_pence
   FROM order_refunds r
     JOIN platform_listings pl ON pl.id = r.platform_listing_id
     JOIN master_products mp ON mp.id = pl.master_product_id
     JOIN stores s ON s.id = pl.store_id
     JOIN platforms plat ON plat.id = s.platform_id
     -- The original sale, if it's been imported
     LEFT JOIN LATERAL ( SELECT oli.qty, oli.sale_price_gross_pence, oli.order_date, oli.service_level
           FROM order_line_items oli
          WHERE oli.platform_listing_id = r.platform_listing_id AND oli.external_id = r.original_external_id
         LIMIT 1) orig ON true
     CROSS JOIN LATERAL ( SELECT COALESCE(r.qty,
            CASE
                WHEN orig.qty IS NULL THEN 1
                WHEN orig.sale_price_gross_pence <= 0 THEN orig.qty
                ELSE LEAST(orig.qty, GREATEST(0, round(((r.refund_gross_pence)::numeric * (orig.qty)::numeric) / (orig.sale_price_gross_pence)::numeric)))::integer
            END) AS qty) units
     -- VAT registration on the original sale's date (refund date if the sale isn't imported) (store_vat_status history; the store's current flag only as a fallback)
     LEFT JOIN LATERAL ( SELECT vs.vat_registered
           FROM store_vat_status vs
          WHERE vs.store_id = s.id AND vs.effective_from <= COALESCE(orig.order_date, r.refund_date)
          ORDER BY vs.effective_from DESC
         LIMIT 1) vs ON true
     CROSS JOIN LATERAL ( SELECT COALESCE(vs.vat_registered, s.vat_registered) AS registered) vat
     CROSS JOIN LATERAL ( SELECT (
            CASE
                WHEN vat.registered THEN ((r.refund_gross_pence - r.refund_vat_pence) + (r.shipping_refund_gross_pence - r.shipping_refund_vat_pence))
                ELSE (r.refund_gross_pence + r.shipping_refund_gross_pence)
            END)::numeric AS revenue_pence) rev
     -- Landed cost per unit on the original sale's date (or the refund date if the sale isn't in)
     LEFT JOIN LATERAL ( SELECT sum(latest.amount_pence) AS landed_gross_pence,
            sum(latest.net_pence) AS landed_net_pence
           FROM ( SELECT DISTINCT ON (cc.component_type, COALESCE(cc.description, ''))
                    cc.amount_pence,
                    round(((cc.amount_pence)::numeric - (((cc.amount_pence)::numeric * cc.vat_rate) / ((1)::numeric + cc.vat_rate)))) AS net_pence
                   FROM cogs_components cc
                     JOIN cost_types ct ON ct.code = cc.component_type
                  WHERE cc.master_product_id = mp.id AND ct.in_gross
                    AND (cc.store_id IS NULL OR cc.store_id = s.id)
                    AND cc.effective_from <= COALESCE(orig.order_date, r.refund_date)
                  ORDER BY cc.component_type, COALESCE(cc.description, ''), (cc.store_id IS NULL), cc.effective_from DESC) latest) cogs ON true
     CROSS JOIN LATERAL ( SELECT
            -- stock back on the shelf: the product cost comes off
            -(CASE
                WHEN vat.registered THEN COALESCE(cogs.landed_net_pence, (0)::numeric)
                ELSE (COALESCE(cogs.landed_gross_pence, (0)::bigint))::numeric
            END * ((units.qty * pl.units_per_sale))::numeric) AS product_cost_pence,
            (CASE
                WHEN vat.registered THEN (r.fees_gross_pence - r.fees_vat_pence)
                ELSE r.fees_gross_pence
            END)::numeric AS fees_pence,
            CASE
                WHEN vat.registered THEN COALESCE(round((r.return_shipping_cost_pence)::numeric / 1.2), (0)::numeric)
                ELSE (COALESCE(r.return_shipping_cost_pence, 0))::numeric
            END AS shipping_pence) c;

do $$
declare
  changed integer;
begin
  select count(*) into changed
    from margin_lines_before b
    full join margin_lines m on m.order_line_item_id = b.order_line_item_id
   where b.order_line_item_id is null or m.order_line_item_id is null
      or (b.line_type, b.revenue_pence, b.product_cost_pence, b.total_cost_pence, b.margin_pence, b.shipping_pence)
         is distinct from (m.line_type, m.revenue_pence, m.product_cost_pence, m.total_cost_pence, m.margin_pence, m.shipping_pence);
  if changed > 0 then
    raise exception 'Stopped: % margin line(s) would change. Nothing has been changed. Send this message to Claude.', changed;
  end if;
end $$;

commit;

-- Should show: true, true
select
  exists (select 1 from information_schema.columns where table_name = 'stores' and column_name = 'fulfilled_by_channel') as store_setting_added,
  exists (select 1 from information_schema.columns where table_name = 'cogs_components' and column_name = 'store_id') as store_costs_added;
