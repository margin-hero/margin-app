-- Step 2 of RLS + Auth: link logged-in users (Supabase Auth) to tenants.
--
--   tenant_members       which user belongs to which tenant (a user could later
--                        belong to more than one, e.g. an accountant)
--   current_tenant_id()  the logged-in user's tenant. Every table's RLS policy will
--                        be "tenant_id = current_tenant_id()" (step 3), and new rows
--                        will default their tenant_id to it.
--
-- This changes nothing for the app yet: the existing allow-all test policies stay
-- until step 3. Users are added by hand in the SQL editor for now (no sign-up page).
--
-- Pages affected: none yet.

create table if not exists tenant_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- Real policy (not a temporary allow-all): a user can only see their own memberships.
-- No insert/update/delete from the app: memberships are managed in the SQL editor.
grant select on table tenant_members to authenticated;
alter table tenant_members enable row level security;
drop policy if exists "members_read_own" on tenant_members;
create policy "members_read_own" on tenant_members for select to authenticated
  using (user_id = auth.uid());

-- The logged-in user's tenant (null when logged out or not linked).
-- security definer = can read tenant_members regardless of its policy, so table
-- policies that call it don't loop. If a user is ever in several tenants, the
-- first one they joined is used until a tenant switcher exists.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.tenant_id
  from public.tenant_members tm
  where tm.user_id = auth.uid()
  order by tm.created_at
  limit 1
$$;

revoke execute on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to authenticated;
