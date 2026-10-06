-- Refunds.
--
-- * order_refunds: one row per refunded order line (Amazon first; other channels later).
--   Matched to the product by SKU like sales (platform_listing_id), and linked to the
--   original sale by original_external_id (e.g. Amazon's order-item-code), so a refund
--   can be imported before or after its sale and links up automatically either way.
--   Re-uploads are deduped on (platform_listing_id, external_id), like order_line_items.
--   All amounts are positive = what was given back, except fees_gross_pence, which is the
--   CHANGE in fees as a cost (negative when the channel returns more fees than it keeps).
-- * order_line_fees can now belong to a refund instead of a sale (e.g. RefundCommission).
-- * margin_lines (view): every sale from order_margins plus one NEGATIVE row per refund,
--   with the same columns, so dashboards that add rows up come out net of refunds.
--   Extra columns: line_type ('sale' | 'refund'), refunded_units, gross_sales_pence.
--   A refund row counts on its refund date and contains:
--     revenue       = minus the refunded price (+ refunded shipping), net of VAT if registered
--     product cost  = minus landed cost x refunded units (assumed resaleable: back in stock),
--                     at the costs in effect on the original sale's date
--     fees          = the change in fees (fees given back, minus any refund admin fee)
--     shipping      = return postage paid by the seller (20% VAT assumed)
--     other costs   = 0 (packaging etc. was used on the sale, so it stays a cost)
--   Refunded units: the channel's figure if given, otherwise refunded price ÷ the original
--   sale's price per unit, rounded (so a refund under half a unit's price = 0 units, e.g. a
--   goodwill payment), capped at the units sold. 1 if the sale isn't imported yet.
--
-- order_margins is NOT changed. Pages affected: Channel Overview, Margins, SKU Detail,
-- Trends, Opportunities and /order-lines move to margin_lines (in the same code change).
-- /costs, the missing-costs banner and /overheads stay on order_margins (sales only).
--
-- Runs in one transaction: if any step fails, nothing is changed.

begin;

-- 1. Refunds ------------------------------------------------------------------------

create table order_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references tenants(id) on delete cascade,
  platform_listing_id uuid not null references platform_listings(id) on delete cascade,
  external_id text not null,          -- the refund's own ID, e.g. Amazon adjustment-id + order-item-code
  original_external_id text,          -- the sale's external_id in order_line_items
  refund_date date not null,
  qty integer,                        -- units refunded, if the channel says (Amazon doesn't)
  refund_gross_pence integer not null default 0,
  refund_vat_pence integer not null default 0,
  shipping_refund_gross_pence integer not null default 0,
  shipping_refund_vat_pence integer not null default 0,
  fees_gross_pence integer not null default 0, -- change in fees as a cost (negative = fees given back)
  fees_vat_pence integer not null default 0,
  return_shipping_cost_pence integer, -- return label paid by the seller, inc. VAT
  created_at timestamptz not null default now(),
  constraint order_refunds_listing_external_id_key unique (platform_listing_id, external_id)
);

create index order_refunds_tenant_id_idx on order_refunds (tenant_id);
create index order_refunds_refund_date_idx on order_refunds (refund_date);
create index order_refunds_original_idx on order_refunds (platform_listing_id, original_external_id);

grant select, insert, update, delete on table order_refunds to authenticated;
alter table order_refunds enable row level security;
create policy tenant_isolation on order_refunds for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- 2. Fee breakdown rows can belong to a refund ---------------------------------------

alter table order_line_fees alter column order_line_item_id drop not null;
alter table order_line_fees add column order_refund_id uuid references order_refunds(id) on delete cascade;
alter table order_line_fees add constraint order_line_fees_one_parent
  check (num_nonnulls(order_line_item_id, order_refund_id) = 1);
create index order_line_fees_order_refund_id_idx on order_line_fees (order_refund_id);

-- 3. Sales and refunds together, for the dashboards --------------------------------

create view margin_lines with (security_invoker = true) as
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
    s.vat_registered,
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
     CROSS JOIN LATERAL ( SELECT (
            CASE
                WHEN s.vat_registered THEN ((r.refund_gross_pence - r.refund_vat_pence) + (r.shipping_refund_gross_pence - r.shipping_refund_vat_pence))
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
                    AND cc.effective_from <= COALESCE(orig.order_date, r.refund_date)
                  ORDER BY cc.component_type, COALESCE(cc.description, ''), cc.effective_from DESC) latest) cogs ON true
     CROSS JOIN LATERAL ( SELECT
            -- stock back on the shelf: the product cost comes off
            -(CASE
                WHEN s.vat_registered THEN COALESCE(cogs.landed_net_pence, (0)::numeric)
                ELSE (COALESCE(cogs.landed_gross_pence, (0)::bigint))::numeric
            END * ((units.qty * pl.units_per_sale))::numeric) AS product_cost_pence,
            (CASE
                WHEN s.vat_registered THEN (r.fees_gross_pence - r.fees_vat_pence)
                ELSE r.fees_gross_pence
            END)::numeric AS fees_pence,
            CASE
                WHEN s.vat_registered THEN COALESCE(round((r.return_shipping_cost_pence)::numeric / 1.2), (0)::numeric)
                ELSE (COALESCE(r.return_shipping_cost_pence, 0))::numeric
            END AS shipping_pence) c;

grant select on margin_lines to authenticated;

commit;
