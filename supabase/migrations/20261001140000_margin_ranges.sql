-- User-set margin colour ranges (overall, per tenant):
--   red   = margin below margin_red_below
--   green = margin at or above margin_green_from
--   amber = in between
-- Defaults match the previous hardcoded values (10% / 20%), so nothing changes
-- until the tenant edits them on /settings.
-- Per-store and per-product overrides are on the roadmap.
--
-- Pages affected: /grid, /channel-overview, /sku-detail (colours only), new /settings.

begin;

alter table tenants
  add column margin_red_below numeric not null default 10,
  add column margin_green_from numeric not null default 20;

alter table tenants
  add constraint tenants_margin_ranges_order check (margin_green_from >= margin_red_below);

commit;
