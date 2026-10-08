-- Delivery labels as their own records, so late carrier corrections count.
--
-- Amazon charges a label on the day of the sale, but the carrier's adjustments and refunded
-- labels can come weeks later, in a later report. Until now the label cost was saved on the
-- order line at import, and a re-import skips lines already in, so those corrections were lost
-- (about £1,500 back to the seller in August 2026).
--
-- 1. shipping_label_charges: one row per label transaction (purchase / carrier adjustment /
--    refunded label) per order, for the store that ships it. amount_pence = cost inc. VAT
--    (negative = money back). source_key makes each transaction unique, so overlapping
--    uploads never count one twice. A correction can arrive before or after its sale.
-- 2. order_margins: shipping priority 1 is now the order's labels from this table (once its
--    label purchase is in), shared across the order's lines by sale price, counted on the
--    original sale's date. Then the label cost on the line itself (lines imported before
--    this change), then shipping rule, then profile, as before. Column list unchanged, so
--    margin_lines doesn't need re-creating.
--
-- The table starts empty, so no figure changes: checked line by line (cancels if not).
-- Re-upload the Amazon Transaction report afterwards to fill it.
--
-- Pages affected: every dashboard (via margin_lines), /order-lines, Cost Check, the
-- missing-costs banner, /amazon-import.
--
-- Runs in one transaction: if any step fails, nothing is changed.

begin;

create temp table margin_lines_before on commit drop as
  select order_line_item_id, line_type, revenue_pence, product_cost_pence, total_cost_pence, margin_pence, shipping_pence, shipping_source
  from margin_lines;

create table shipping_label_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references tenants(id) on delete cascade,
  store_id uuid not null references stores(id) on delete cascade,
  order_ref text not null, -- the channel's order ID (for Amazon = order_line_items.external_id)
  charge_date date not null,
  kind text not null check (kind in ('label', 'adjustment', 'refund')),
  description text,
  amount_pence integer not null, -- inc. VAT; negative = money back
  source_key text not null, -- unique per transaction, so re-uploads are skipped
  imported_at timestamptz not null default now(),
  constraint shipping_label_charges_source_key unique (store_id, source_key)
);

create index shipping_label_charges_order_idx on shipping_label_charges (store_id, order_ref);
-- finding an order's other lines (and the importers' duplicate check) by external_id
create index if not exists order_line_items_external_id_idx on order_line_items (external_id);

grant select, insert, update, delete on table shipping_label_charges to authenticated;
alter table shipping_label_charges enable row level security;
create policy tenant_isolation on shipping_label_charges for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

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
     -- Priority 1: labels bought through the channel (shipping_label_charges: the purchase plus
     -- the carrier's later adjustments / refunded labels), used once the order's label purchase
     -- is in. Labels belong to the whole order, so each line gets a share by sale price across
     -- the order's lines in this store. Cumulative rounding (in line ID order) makes the shares
     -- add up to the order's total exactly.
     LEFT JOIN LATERAL ( SELECT sum(lc.amount_pence) AS total_pence
           FROM shipping_label_charges lc
          WHERE lc.store_id = s.id AND lc.order_ref = oli.external_id
         HAVING bool_or(lc.kind = 'label')) lbl ON true
     LEFT JOIN LATERAL ( SELECT sum(o2.sale_price_gross_pence) AS order_gross,
            sum(o2.sale_price_gross_pence) FILTER (WHERE o2.id <= oli.id) AS upto_gross,
            count(*) AS lines,
            count(*) FILTER (WHERE o2.id <= oli.id) AS upto_lines
           FROM order_line_items o2
             JOIN platform_listings p2 ON p2.id = o2.platform_listing_id
          WHERE lbl.total_pence IS NOT NULL AND p2.store_id = s.id AND o2.external_id = oli.external_id) ord ON true
     CROSS JOIN LATERAL ( SELECT
            CASE
                WHEN lbl.total_pence IS NULL THEN NULL::integer
                WHEN ord.order_gross > 0 THEN (round((lbl.total_pence)::numeric * ord.upto_gross / ord.order_gross)
                                            - round((lbl.total_pence)::numeric * (ord.upto_gross - oli.sale_price_gross_pence) / ord.order_gross))::integer
                ELSE (round((lbl.total_pence)::numeric * ord.upto_lines / ord.lines)
                    - round((lbl.total_pence)::numeric * (ord.upto_lines - 1) / ord.lines))::integer
            END AS label_cost_pence) label
     CROSS JOIN LATERAL ( SELECT
            -- a store fulfilled by the channel (e.g. Amazon FBA) has no shipping cost of its own: the channel's fee covers it
            COALESCE(label.label_cost_pence, oli.actual_shipping_cost_pence, CASE WHEN s.fulfilled_by_channel THEN 0 END, sr.courier_cost_pence, prof.cost_pence) AS shipping_cost_gross_pence,
            CASE
                WHEN label.label_cost_pence IS NOT NULL OR oli.actual_shipping_cost_pence IS NOT NULL OR sr.courier_cost_pence IS NOT NULL THEN COALESCE(sr.vat_rate, 0.20)
                ELSE COALESCE(prof.vat_rate, 0.20)
            END AS shipping_vat_rate,
            CASE
                WHEN label.label_cost_pence IS NOT NULL OR oli.actual_shipping_cost_pence IS NOT NULL THEN 'label'
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

do $$
declare
  changed integer;
begin
  select count(*) into changed
    from margin_lines_before b
    full join margin_lines m on m.order_line_item_id = b.order_line_item_id
   where b.order_line_item_id is null or m.order_line_item_id is null
      or (b.line_type, b.revenue_pence, b.product_cost_pence, b.total_cost_pence, b.margin_pence, b.shipping_pence, b.shipping_source)
         is distinct from (m.line_type, m.revenue_pence, m.product_cost_pence, m.total_cost_pence, m.margin_pence, m.shipping_pence, m.shipping_source);
  if changed > 0 then
    raise exception 'Stopped: % margin line(s) would change. Nothing has been changed. Send this message to Claude.', changed;
  end if;
end $$;

commit;

-- Should show: true
select exists (select 1 from information_schema.tables where table_name = 'shipping_label_charges') as label_table_added;
