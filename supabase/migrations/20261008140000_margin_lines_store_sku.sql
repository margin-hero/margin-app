-- margin_lines: add each line's store SKU (platform_listing_id), as the last column.
--
-- Reports add up by product x store. When one product has several store SKUs in the same
-- store (e.g. an Amazon Grade & Resell "amzn.gr." SKU next to the FBA one, or the same item
-- listed twice), SKU Detail can now show each store SKU's figures under the product's row,
-- and /order-lines shows the store SKU.
--
-- Re-created from 20261006200000_fba_stores.sql (the latest margin_lines) with only that one
-- column added. order_margins is unchanged (20261008120000_shipping_label_charges.sql). No
-- figure changes: checked line by line (cancels if not).
--
-- Pages affected: every dashboard (they read margin_lines), /order-lines, /sku-detail.
--
-- Runs in one transaction: if any step fails, nothing is changed.

begin;

create temp table margin_lines_before on commit drop as
  select order_line_item_id, line_type, revenue_pence, product_cost_pence, total_cost_pence, margin_pence, shipping_pence, shipping_source
  from margin_lines;

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
    (oli.sale_price_gross_pence + COALESCE(oli.shipping_revenue_gross_pence, 0)) AS gross_sales_pence,
    oli.platform_listing_id
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
    -(r.refund_gross_pence + r.shipping_refund_gross_pence) AS gross_sales_pence,
    r.platform_listing_id
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
      or (b.line_type, b.revenue_pence, b.product_cost_pence, b.total_cost_pence, b.margin_pence, b.shipping_pence, b.shipping_source)
         is distinct from (m.line_type, m.revenue_pence, m.product_cost_pence, m.total_cost_pence, m.margin_pence, m.shipping_pence, m.shipping_source);
  if changed > 0 then
    raise exception 'Stopped: % margin line(s) would change. Nothing has been changed. Send this message to Claude.', changed;
  end if;
end $$;

commit;

-- Should show: true
select exists (select 1 from information_schema.columns where table_name = 'margin_lines' and column_name = 'platform_listing_id') as store_sku_added;
