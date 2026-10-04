-- Step 3 of RLS + Auth: THE LOCK-DOWN. After this, each logged-in user only sees
-- and changes their own tenant's data, and logged-out visitors see nothing.
--
-- 1. tenant_id is added to the 7 tables that didn't have it, filled in from each
--    row's parent, and defaults to current_tenant_id() for new rows (so the app
--    and importers don't have to pass it).
-- 2. Every old "temporary test" / dev_allow_all_TEMPORARY policy is dropped.
-- 3. One policy pattern on every tenant table: tenant_id = current_tenant_id().
--    tenants: only your own row. platforms / cost_types: shared, read-only.
-- 4. Views run as the user (security_invoker), so they obey the policies above.
--    Without this, order_margins would show every tenant's margins.
-- 5. Logged-out visitors (anon) lose all table access.
--
-- All-or-nothing: wrapped in a transaction, so if anything fails nothing changes.
--
-- NOTE for the SQL editor: it runs as admin (bypasses RLS) but isn't logged in, so
-- current_tenant_id() is null there. When inserting rows by hand (e.g. dummy FBA
-- data), give tenant_id explicitly.
--
-- Pages affected: ALL app pages (they now need a login). Dashboards read
-- order_margins, which now runs with the user's permissions.

begin;

-- ---- 1. tenant_id on the tables that lack it, filled from the parent row ----

alter table platform_listings add column if not exists tenant_id uuid references tenants(id) on delete cascade;
update platform_listings c set tenant_id = p.tenant_id
  from master_products p where c.master_product_id = p.id and c.tenant_id is null;

alter table order_line_items add column if not exists tenant_id uuid references tenants(id) on delete cascade;
update order_line_items c set tenant_id = p.tenant_id
  from platform_listings p where c.platform_listing_id = p.id and c.tenant_id is null;

alter table cogs_components add column if not exists tenant_id uuid references tenants(id) on delete cascade;
update cogs_components c set tenant_id = p.tenant_id
  from master_products p where c.master_product_id = p.id and c.tenant_id is null;

alter table shipping_rules add column if not exists tenant_id uuid references tenants(id) on delete cascade;
update shipping_rules c set tenant_id = p.tenant_id
  from master_products p where c.master_product_id = p.id and c.tenant_id is null;

alter table product_shipping_profiles add column if not exists tenant_id uuid references tenants(id) on delete cascade;
update product_shipping_profiles c set tenant_id = p.tenant_id
  from master_products p where c.master_product_id = p.id and c.tenant_id is null;

alter table courier_service_prices add column if not exists tenant_id uuid references tenants(id) on delete cascade;
update courier_service_prices c set tenant_id = p.tenant_id
  from courier_services p where c.courier_service_id = p.id and c.tenant_id is null;

alter table shipping_profile_bands add column if not exists tenant_id uuid references tenants(id) on delete cascade;
update shipping_profile_bands c set tenant_id = p.tenant_id
  from shipping_profiles p where c.shipping_profile_id = p.id and c.tenant_id is null;

-- Required + defaults to the logged-in user's tenant, on every tenant table.
-- "set not null" fails (and the whole migration rolls back) if any row couldn't be filled.
do $$
declare t text;
begin
  foreach t in array array[
    'master_products', 'platform_listings', 'order_line_items', 'cogs_components',
    'shipping_rules', 'tiktok_sku_catalog', 'stores', 'courier_services',
    'courier_service_prices', 'shipping_profiles', 'shipping_profile_bands',
    'product_shipping_profiles', 'overheads'
  ] loop
    execute format('alter table %I alter column tenant_id set default public.current_tenant_id()', t);
    execute format('alter table %I alter column tenant_id set not null', t);
    execute format('create index if not exists %I on %I (tenant_id)', t || '_tenant_id_idx', t);
  end loop;
end $$;

-- ---- 2. Drop every old policy (all were allow-all test policies) ----

do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename <> 'tenant_members'
  loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---- 3. Real policies ----

do $$
declare t text;
begin
  foreach t in array array[
    'master_products', 'platform_listings', 'order_line_items', 'cogs_components',
    'shipping_rules', 'tiktok_sku_catalog', 'stores', 'courier_services',
    'courier_service_prices', 'shipping_profiles', 'shipping_profile_bands',
    'product_shipping_profiles', 'overheads'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I for all to authenticated
         using (tenant_id = public.current_tenant_id())
         with check (tenant_id = public.current_tenant_id())', t);
  end loop;
end $$;

-- Your own tenant row: read it and change its settings (VAT, margin cut-offs, overhead basis)
alter table tenants enable row level security;
create policy own_tenant_read on tenants for select to authenticated using (id = public.current_tenant_id());
create policy own_tenant_update on tenants for update to authenticated
  using (id = public.current_tenant_id()) with check (id = public.current_tenant_id());

-- Shared lists, added by migration only
alter table platforms enable row level security;
create policy platforms_read on platforms for select to authenticated using (true);
alter table cost_types enable row level security;
create policy cost_types_read on cost_types for select to authenticated using (true);

-- ---- 4. Views obey the user's policies ----

alter view order_margins set (security_invoker = true);
alter view sku_channel_margins set (security_invoker = true);

-- ---- 5. Logged-out visitors get nothing ----

revoke all on all tables in schema public from anon;

commit;
