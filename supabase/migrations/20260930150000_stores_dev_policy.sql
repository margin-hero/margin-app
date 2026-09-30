-- Fix "new row violates row-level security policy for table stores".
-- Supabase switched RLS on for the new stores table, with no policies, so
-- everything was blocked.
--
-- TEMPORARY: allows anyone with the anon key full access, matching how the
-- other tables currently behave in dev. Replace with real per-tenant policies
-- when Supabase Auth arrives (roadmap: "Before real customers").
--
-- Pages affected: /stores, every importer's store picker, /mappings,
-- /products/[id].

create policy "dev_allow_all_TEMPORARY" on stores
  for all
  to anon, authenticated
  using (true)
  with check (true);
