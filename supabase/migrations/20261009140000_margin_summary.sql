-- margin_summary(from, to): the dashboards' totals, added up inside the database.
--
-- Until now each dashboard fetched every sale / refund line in its date range from
-- margin_lines (1,000 at a time, the view worked out again for each batch) and added them up
-- in the browser. A year of data = tens of thousands of lines. This function adds them up in
-- one go and returns one total per store x product x store SKU x month x sale/refund, as a
-- single JSON answer (so Supabase's 1,000-row cap doesn't apply and it's worked out once).
--
-- Each total has the same columns the pages used to add up, plus:
--   lines       = how many lines it covers (sale lines = orders, for the "orders" overhead basis)
--   month       = "2026-08" (Trends), first_date / last_date (the data's date span)
-- Percentages are still worked out from these totals on the page, never averaged.
--
-- Runs as the logged-in user (security invoker, like the views), so RLS still applies: each
-- tenant only gets their own totals. date_from / date_to null = no limit (all time).
--
-- Also: an index on order_line_items.order_date so a date range doesn't read every line.
--
-- No tables, views or figures change. Pages affected: none yet (they switch over one by
-- one: Channel Overview first). Can be run again safely.

begin;

create index if not exists order_line_items_order_date_idx on order_line_items (order_date);

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
      sum(gross_sales_pence) as gross_sales_pence
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
         coalesce(sum((x->>'product_cost_pence')::numeric), 0) as product_cost,
         coalesce(sum((x->>'gross_sales_pence')::numeric), 0) as gross_sales
    into s
    from jsonb_array_elements(public.margin_summary()) x;
  select count(*) as lines,
         coalesce(sum(revenue_pence), 0) as revenue,
         coalesce(sum(margin_pence), 0) as margin,
         coalesce(sum(product_cost_pence), 0) as product_cost,
         coalesce(sum(gross_sales_pence), 0) as gross_sales
    into m
    from margin_lines;
  if (s.lines, s.revenue, s.margin, s.product_cost, s.gross_sales) is distinct from
     (m.lines::numeric, m.revenue::numeric, m.margin::numeric, m.product_cost::numeric, m.gross_sales::numeric) then
    raise exception 'Stopped: the summary doesn''t match margin_lines (% vs % lines). Nothing has been changed. Send this message to Claude.', s.lines, m.lines;
  end if;
end $$;

commit;

-- Should show: the number of lines and totals in the summary (matching margin_lines)
select sum((x->>'lines')::numeric) as lines, sum((x->>'revenue_pence')::numeric) as revenue_pence, count(*) as summary_rows
from jsonb_array_elements(public.margin_summary()) x;
