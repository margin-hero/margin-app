-- TESTING ONLY: let the app delete order lines (the "Delete selected" button on the
-- unlisted /order-lines page). Without this, Supabase says
-- "permission denied for table order_line_items".
--
-- Must be replaced by tenant-scoped RLS before real data goes live (see
-- "Lock down everything before real data goes live" in docs/margin-saas-roadmap.md).
--
-- Safe to run twice. Doesn't change any data or views.
-- Pages affected: /order-lines (delete). Nothing else changes.

grant delete on order_line_items to anon, authenticated;

-- If row-level security is switched on for this table, deletes also need a policy.
-- Only adds one when there isn't already a policy that covers deleting.
do $$
begin
  if (select relrowsecurity from pg_class where oid = 'public.order_line_items'::regclass)
     and not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'order_line_items' and cmd in ('DELETE', 'ALL')
     )
  then
    execute 'create policy "dev_allow_delete_TEMPORARY" on order_line_items for delete to anon, authenticated using (true)';
  end if;
end $$;
