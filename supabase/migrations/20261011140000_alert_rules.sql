-- Alerts (/dashboards/alerts): each business's alert settings, and the newest order date per
-- store (for "import overdue").
--
-- 1. alert_rules: one row per rule the business has changed (switched off, or a different
--    threshold). No row = the rule is on with its default threshold (set in lib/alerts.ts),
--    so nothing needs adding for existing tenants. Rule codes: loss, margin_drop, acos,
--    fee_change, missing_costs, stale_import.
-- 2. store_last_order_dates(): the newest order date in each store, worked out in the
--    database (runs as the logged-in user, so RLS applies).
--
-- No existing tables, views or figures change. Pages affected: /dashboards/alerts and the
-- alerts strip on /dashboards/overview (until this runs they use the default settings and
-- skip "import overdue"). Can be run again safely.

begin;

create table if not exists alert_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references tenants(id) on delete cascade,
  rule_code text not null check (rule_code in ('loss', 'margin_drop', 'acos', 'fee_change', 'missing_costs', 'stale_import')),
  enabled boolean not null default true,
  threshold numeric, -- null = the rule's default
  updated_at timestamptz not null default now(),
  constraint alert_rules_tenant_rule_key unique (tenant_id, rule_code)
);

grant select, insert, update, delete on table alert_rules to authenticated;
alter table alert_rules enable row level security;
drop policy if exists tenant_isolation on alert_rules;
create policy tenant_isolation on alert_rules for all to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create or replace function public.store_last_order_dates()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb)
  from (
    select pl.store_id, max(oli.order_date) as last_order_date
    from order_line_items oli
    join platform_listings pl on pl.id = oli.platform_listing_id
    group by pl.store_id
  ) x
$$;

revoke execute on function public.store_last_order_dates() from public, anon;
grant execute on function public.store_last_order_dates() to authenticated;

commit;

-- Should show: each store's newest order date (all tenants, as the SQL editor sees everything)
select s.name, (x->>'last_order_date')::date as last_order_date
from jsonb_array_elements(public.store_last_order_dates()) x
join stores s on s.id = (x->>'store_id')::uuid
order by s.name;
