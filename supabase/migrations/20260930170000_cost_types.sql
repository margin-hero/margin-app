-- Fixed cost types, per-order costs, and landed cost in Gross Profit.
--
-- * cost_types: a fixed list. Each type says how it's charged (per unit, or once
--   per order line) and whether it's part of landed cost (counts in Gross Profit).
--   Users with an all-in landed cost use "Landed cost (all-in)"; users who break
--   it down use Product cost + Inbound freight + Import duty.
-- * cogs_components.description: optional label, so e.g. two different
--   "Other per-unit cost" rows can both apply at once. The "latest cost wins"
--   rule now works per (type, description).
-- * Existing costs with free-text types become "Other per-unit cost" with the old
--   text kept as the description, so every margin figure stays exactly the same.
--   Existing 'cost_price' rows are unchanged (that code is kept as Product cost).
--
-- order_margins changes:
--   product_cost_pence = ALL landed-cost types x quantity (was: cost_price only)
--   other_cost_pence   = other per-unit types x quantity + per-order types (once)
--   per_order_cost_pence (new, last column) = the per-order part of other_cost_pence
--   All other columns and their order are unchanged.
--
-- Pages affected: every dashboard (/grid, /channel-overview, /sku-detail,
-- /margins, /trends), /costs, the missing-costs banner, /products/[id].
--
-- Runs in one transaction: if any step fails, nothing is changed.

begin;

-- 1. The list of cost types ---------------------------------------------------

create table cost_types (
  code text primary key,
  label text not null,
  basis text not null check (basis in ('per_unit', 'per_order')),
  in_gross boolean not null,
  sort_order integer not null,
  description text not null,
  -- landed-cost types are always per unit
  constraint cost_types_gross_is_per_unit check (not in_gross or basis = 'per_unit')
);

insert into cost_types (code, label, basis, in_gross, sort_order, description) values
  ('landed_cost_all_in', 'Landed cost (all-in)',        'per_unit',  true,  10, 'One figure covering supplier price, freight and duty. Don''t also add those separately.'),
  ('cost_price',         'Product cost (supplier price)','per_unit', true,  20, 'What you pay the supplier per unit. Add freight and duty separately if you break them down.'),
  ('inbound_freight',    'Inbound freight',             'per_unit',  true,  30, 'Shipping from your supplier to you, per unit.'),
  ('import_duty',        'Import duty',                 'per_unit',  true,  40, 'Customs duty per unit. Usually 0% VAT.'),
  ('unit_packaging',     'Unit packaging',              'per_unit',  false, 50, 'Inner packaging for each item.'),
  ('weee_per_unit',      'WEEE / compliance (per unit)','per_unit',  false, 60, 'Per-unit compliance fees. The annual registration fee is an overhead instead.'),
  ('packaging_epr',      'Packaging EPR fee',           'per_unit',  false, 70, 'UK packaging Extended Producer Responsibility fee per unit.'),
  ('other_per_unit',     'Other per-unit cost',         'per_unit',  false, 80, 'Anything else charged for every unit sold. Add a description.'),
  ('pick_pack',          'Pick & pack',                 'per_order', false, 110, 'Charged once per order line, however many units. In-house is usually 0% VAT, a 3PL usually 20%.'),
  ('outer_packaging',    'Outer box / mailer',          'per_order', false, 120, 'The box or mailer the order ships in, once per order line.'),
  ('other_per_order',    'Other per-order cost',        'per_order', false, 130, 'Anything else charged once per order line. Add a description.');

-- The app reads this list; only migrations change it.
grant select on table cost_types to anon, authenticated;
alter table cost_types enable row level security;
create policy "cost_types_read_all" on cost_types for select to anon, authenticated using (true);

-- 2. Optional description on each cost, and move free-text types onto the list -

alter table cogs_components add column description text;

update cogs_components
set description = component_type,
    component_type = 'other_per_unit'
where component_type not in (select code from cost_types);

alter table cogs_components
  add constraint cogs_components_component_type_fkey
  foreign key (component_type) references cost_types(code);

-- 3. order_margins ------------------------------------------------------------
-- Same columns in the same order as before, with per_order_cost_pence added last.

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
    c.per_order_cost_pence
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
