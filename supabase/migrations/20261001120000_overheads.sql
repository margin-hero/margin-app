-- Overheads: costs that can't be tied to one order (wages, rent, rates, utilities,
-- subscriptions, registrations, equipment...). They're turned into a cost per day
-- and shared across sales at reporting time, by the tenant's chosen basis.
-- They only ever reduce Net Profit, never Gross.
--
-- kind = 'recurring': repeats every `frequency` from start_date until end_date
--        (end_date null = ongoing).
-- kind = 'one_off':   a single cost on start_date, spread evenly over
--        `spread_months` months (1 = just that month; 36 = e.g. a machine's useful life).
--
-- store_id null = whole business (shared across all stores' sales);
-- store_id set  = belongs to that store only (shared across that store's sales).
--
-- tenants.overhead_allocation_basis: how overheads are shared across sales:
--   'revenue' (default) | 'units' | 'orders' (order lines)
--
-- No view changes: order_margins is untouched, so no dashboard figures change
-- until a page chooses to show "after overheads".
-- Pages affected: new /overheads; /channel-overview and /grid gain overhead figures.
--
-- RLS reminder: TEMPORARY allow-all policy until Supabase Auth + real RLS.

begin;

create table overheads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  name text not null,
  category text not null check (category in ('wages', 'rent', 'business_rates', 'utilities', 'subscriptions', 'registrations', 'equipment', 'professional_fees', 'insurance', 'other')),
  amount_pence integer not null check (amount_pence >= 0),
  vat_rate numeric not null check (vat_rate >= 0 and vat_rate < 1),
  kind text not null check (kind in ('recurring', 'one_off')),
  frequency text check (frequency in ('weekly', 'four_weekly', 'monthly', 'quarterly', 'yearly')),
  spread_months integer check (spread_months >= 1),
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  -- recurring needs a frequency; one-off needs a spread and no end date (it's worked out)
  constraint overheads_kind_fields check (
    (kind = 'recurring' and frequency is not null and spread_months is null)
    or (kind = 'one_off' and spread_months is not null and frequency is null and end_date is null)
  ),
  constraint overheads_dates check (end_date is null or end_date >= start_date)
);

alter table tenants add column overhead_allocation_basis text not null default 'revenue'
  check (overhead_allocation_basis in ('revenue', 'units', 'orders'));

grant select, insert, update, delete on table overheads to anon, authenticated;
alter table overheads enable row level security;
create policy "dev_allow_all_TEMPORARY" on overheads for all to anon, authenticated using (true) with check (true);

commit;
