-- Faster security rules (RLS): look the tenant up once per query, not once per row.
--
-- Every tenant table's rule was "tenant_id = current_tenant_id()". Written like that,
-- Postgres runs current_tenant_id() (a lookup in tenant_members) again for EVERY row it
-- reads. The dashboards read margin_lines, which for each order line also reads its costs,
-- VAT status, shipping rules / profiles and labels, so one month of ~10,000 lines meant
-- hundreds of thousands of repeat lookups, and again for every 1,000-row page.
--
-- Supabase's documented fix: wrap the call in a select, "tenant_id = (select
-- current_tenant_id())". Postgres then works it out once per query and reuses it. The rule
-- means exactly the same thing: nobody sees more or less than before. Same for auth.uid()
-- in tenant_members' rule.
--
-- No tables, columns, views or figures change; only the policies' wording. Can be run
-- again safely (policies already wrapped are skipped).
--
-- Pages affected: none in what they show. Every page should load the same or faster;
-- dashboards (Channel Overview, Margins / Opportunities, SKU Detail, Trends, /order-lines)
-- most of all.
--
-- Runs in one transaction: if any step fails, nothing is changed.

begin;

do $$
declare
  p record;
  new_using text;
  new_check text;
  sql text;
begin
  for p in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ '(current_tenant_id|auth\.uid)\(\)'
        or coalesce(with_check, '') ~ '(current_tenant_id|auth\.uid)\(\)')
      -- already wrapped: leave alone
      and coalesce(qual, '') !~* 'select' and coalesce(with_check, '') !~* 'select'
  loop
    new_using := regexp_replace(p.qual, '(public\.)?current_tenant_id\(\)', '(select public.current_tenant_id())', 'g');
    new_using := regexp_replace(new_using, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    new_check := regexp_replace(p.with_check, '(public\.)?current_tenant_id\(\)', '(select public.current_tenant_id())', 'g');
    new_check := regexp_replace(new_check, 'auth\.uid\(\)', '(select auth.uid())', 'g');

    sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
    if new_using is not null then sql := sql || format(' using (%s)', new_using); end if;
    if new_check is not null then sql := sql || format(' with check (%s)', new_check); end if;
    execute sql;
  end loop;
end $$;

-- Check: no policy left calling either function directly
do $$
declare
  left_over integer;
begin
  select count(*) into left_over
    from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(current_tenant_id|auth\.uid)\(\)'
     and (coalesce(qual, '') || coalesce(with_check, '')) !~* 'select';
  if left_over > 0 then
    raise exception 'Stopped: % policy(ies) could not be updated. Nothing has been changed. Send this message to Claude.', left_over;
  end if;
end $$;

commit;

-- Should show every policy's rule with "SELECT" around current_tenant_id() / auth.uid()
-- (platforms_read / cost_types_read stay "true").
select tablename, policyname, qual as rule from pg_policies where schemaname = 'public' order by tablename;
