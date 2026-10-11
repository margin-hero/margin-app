-- margin_summary(): also add up channel fees and shipping, so the new drill-down dashboards
-- can split costs (Channels "cost stack", Profit Overview "Where the money goes").
--
-- Same function as 20261009140000_margin_summary.sql with two more totals per row:
--   fees_pence      = channel fees (commission, fulfilment, ...), from margin_lines.fees_pence
--   shipping_pence  = your shipping cost, from margin_lines.shipping_pence
-- (Other costs = total_cost − product_cost − fees − shipping, worked out on the page.)
--
-- No tables or views change, and every existing total stays the same: the existing pages
-- just ignore the two new figures. Pages affected: /dashboards/overview, /dashboards/channels
-- (until this runs they show the costs as one figure). Can be run again safely.

begin;

create or replace function public.margin_summary(date_from date default null, date_to date default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(g), '[]'::jsonb)
  from (
    select
      store_id,
      master_product_id,
      platform_listing_id,
      product_name,
      channel,
      line_type,
      to_char(order_date, 'YYYY-MM') as month,
      min(order_date) as first_date,
      max(order_date) as last_date,
      count(*) as lines,
      sum(effective_qty) as effective_qty,
      sum(refunded_units) as refunded_units,
      sum(revenue_pence) as revenue_pence,
      sum(product_cost_pence) as product_cost_pence,
      sum(total_cost_pence) as total_cost_pence,
      sum(margin_pence) as margin_pence,
      sum(gross_sales_pence) as gross_sales_pence,
      sum(fees_pence) as fees_pence,
      sum(shipping_pence) as shipping_pence
    from margin_lines
    where order_date >= coalesce(date_from, '-infinity'::date)
      and order_date <= coalesce(date_to, 'infinity'::date)
    group by store_id, master_product_id, platform_listing_id, product_name, channel, line_type, to_char(order_date, 'YYYY-MM')
  ) g
$$;

revoke execute on function public.margin_summary(date, date) from public, anon;
grant execute on function public.margin_summary(date, date) to authenticated;

-- Check: the summary adds up to exactly the same as margin_lines (all tenants, as the SQL
-- editor sees everything)
do $$
declare
  s record;
  m record;
begin
  select coalesce(sum((x->>'lines')::numeric), 0) as lines,
         coalesce(sum((x->>'revenue_pence')::numeric), 0) as revenue,
         coalesce(sum((x->>'margin_pence')::numeric), 0) as margin,
         coalesce(sum((x->>'fees_pence')::numeric), 0) as fees,
         coalesce(sum((x->>'shipping_pence')::numeric), 0) as shipping
    into s
    from jsonb_array_elements(public.margin_summary()) x;
  select count(*) as lines,
         coalesce(sum(revenue_pence), 0) as revenue,
         coalesce(sum(margin_pence), 0) as margin,
         coalesce(sum(fees_pence), 0) as fees,
         coalesce(sum(shipping_pence), 0) as shipping
    into m
    from margin_lines;
  if (s.lines, s.revenue, s.margin, s.fees, s.shipping) is distinct from
     (m.lines::numeric, m.revenue::numeric, m.margin::numeric, m.fees::numeric, m.shipping::numeric) then
    raise exception 'Stopped: the summary doesn''t match margin_lines (% vs % lines). Nothing has been changed. Send this message to Claude.', s.lines, m.lines;
  end if;
end $$;

commit;

-- Should show: lines, fees and shipping in the summary (matching margin_lines)
select sum((x->>'lines')::numeric) as lines, sum((x->>'fees_pence')::numeric) as fees_pence, sum((x->>'shipping_pence')::numeric) as shipping_pence
from jsonb_array_elements(public.margin_summary()) x;
