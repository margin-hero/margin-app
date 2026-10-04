-- Logged-in users connect as the 'authenticated' role, not 'anon'. The views and the
-- older tables (made before migrations) were only opened up to 'anon', so logged-in
-- pages got "permission denied for view order_margins".
--
-- Gives 'authenticated' the same table access 'anon' has. This doesn't widen what's
-- visible: RLS policies still decide which rows (step 3 limits them to your tenant).
-- Safe to run twice.
--
-- Pages affected: every dashboard (order_margins), plus any page reading/writing
-- the tables below.

grant select on order_margins, sku_channel_margins to authenticated;

grant select, insert, update, delete on table
  tenants, master_products, platform_listings, order_line_items,
  cogs_components, shipping_rules, tiktok_sku_catalog,
  stores, courier_services, courier_service_prices,
  shipping_profiles, shipping_profile_bands, product_shipping_profiles, overheads
to authenticated;

grant select on table platforms, cost_types to authenticated;

-- Any id counters (sequences) the older tables use
grant usage, select on all sequences in schema public to authenticated;
