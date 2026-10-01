@AGENTS.md

# Margin Hero (margin-app)

Multi-tenant SaaS margin/profit calculator for UK e-commerce sellers. Main competitor is Sellerboard. Core focus is strictly **margin**. Don't broaden scope into unrelated features.

I'm building this myself ("vibe coding") and I'm not a professional developer. Explain what you're changing and why in plain English. Keep changes small and focused, and ask before large refactors.

## Stack
- Next.js 16.3 (App Router), React 19.2, TypeScript, Tailwind v4
- Supabase (Postgres) via `@supabase/supabase-js`
- Hosted on Vercel, repo at github.com/margin-hero/margin-app, domain marginhero.co.uk
- Developing on Windows in VS Code
- Libraries: papaparse (CSV), SheetJS xlsx (installed from cdn.sheetjs.com, NOT npm, because of a known npm vulnerability, so don't "fix" this), recharts (charts)
- Resend (email signups) is called directly via `fetch` in `app/api/subscribe`, not installed as a package

## Environment variables
Values live in `.env.local` locally (git-ignored) and in Vercel project settings. Never commit them.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: used by `lib/supabase.ts`
- `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`: used by `app/api/subscribe`

## Working rules
- **Database changes:** do NOT run SQL against Supabase directly. Write SQL as migration files in `supabase/migrations/` (create the folder if missing) and tell me to run them in the Supabase SQL editor. Views that pages depend on (mainly `order_margins`) need extra care. List which pages are affected.
- **Before saying a task is done:** run `npm run build` and fix any TypeScript errors. Vercel builds fail on TS errors.
- **Git:** show me what changed before committing. Use clear commit messages. Don't push without asking.
- **RLS reminder:** real RLS policies and Supabase Auth are deliberately deferred. We're using one test tenant for now. Don't implement them unasked, but remind me when a change makes them more important (e.g. anything going public-facing).

## Money & margin rules (important, these bugs have happened before)
- All money is stored and calculated in **integer pence** (`*_pence` columns). Watch for fractional-penny rounding in VAT splits.
- **Aggregation:** sum totals first, THEN derive percentages from the totals. Never average per-order percentages.
- `margin_percent` uses **net revenue** as the denominator.
- **Gross Profit** = revenue minus landed product cost only (`product_cost_pence` = every `cost_types` row with `in_gross`: all-in landed cost, or product cost + inbound freight + import duty).
- **Net Profit** = revenue minus everything: product cost, other costs, fees, shipping (`total_cost_pence`).
- **Net after overheads** = Net Profit minus each sale's share of overheads. Overheads are NOT in `order_margins`: they're shared at reporting time for the page's date range by `lib/overheads.ts` (`allocateOverheads`), never touching Gross.
- Two VAT modes: VAT registered (net figures throughout) vs not registered (VAT is an irrecoverable cost). VAT rate is per product, not flat. `tax_regime_id` exists for future international taxes.
- Landed cost from third-country imports and in-house picking/packing carry **0% VAT**, not the 20% default.
- COGS must scale by quantity. Bundles use `units_per_sale` on `platform_listings` → `effective_qty`, used for both COGS and shipping lookup.

## Date-tracked costs
- `cogs_components` and `shipping_rules` both use `effective_from`. The view picks the rate where `effective_from <= order_date`.
- UI distinction: **Edit** = correct a mistake (retroactive). **Add** = genuine cost change over time (preserves history).
- New costs for historical products must be backdated or they won't apply to past orders.

## Key tables / views
- `tenants`, `master_products`, `platform_listings`
- `stores`: one shop on one platform (e.g. two TikTok shops for different brands). Holds `vat_registered` (the views use this, not `tenants.vat_registered`). `platform_listings.store_id` is required; a trigger copies `platform_id` from the store. Importers pick a store via `components/StorePicker.tsx` and call `importOrdersForStore`. `shipping_rules.store_id` is optional (null = all stores; a store-specific rule wins). `tiktok_sku_catalog` is per store.
- `platforms`: shared across tenants, added by migration only (no UI, to avoid duplicates). `integration_type` (e.g. `'mirakl'`) is how importers find their platforms; `'csv'` = no dedicated importer, orders come in via `/upload` (e.g. Argos, Shopify)
- `order_line_items`: unique on `(platform_listing_id, external_id)` for dedupe on re-uploads
- `cogs_components`, `shipping_rules`
- Shipping profiles: `courier_services` (+ dated `courier_service_prices`, per parcel, with the service's VAT rate) → `shipping_profiles` with `shipping_profile_bands` (qty range → N parcels × a courier service; `max_qty` null = "and above"; bands are NOT dated) → `product_shipping_profiles` (store_id null = all stores; a store override with null profile = deliberately no shipping cost). Shipping priority in `order_margins`: label cost → `shipping_rules` (exact qty) → profile → missing. `order_margins.shipping_source` = 'label' | 'rule' | 'profile' | 'none' | 'missing'. Pages: `/couriers`, `/shipping-profiles`, assignment on `/products/[id]`.
- `cost_types`: fixed list (migration-only) that `cogs_components.component_type` must reference. `basis` = `per_unit` (× effective_qty) or `per_order` (once per order line; there's no order grouping yet, so a multi-product order is charged per line). `in_gross` = landed cost. `cogs_components.description` is optional; "latest cost wins" applies per (type, description). Per-order costs appear in `other_cost_pence` and separately as `per_order_cost_pence`.
- `overheads`: recurring (weekly / four_weekly / monthly / quarterly / yearly, start + optional end date) or one_off (spread over `spread_months`). `store_id` null = whole business (VAT treatment from `tenants.vat_registered`), set = that store only (store's VAT). Converted to a cost per day, shared by `tenants.overhead_allocation_basis` ('revenue' default | 'units' | 'orders'). "Change amount" ends the old row the day before and inserts a new one (history kept). Shown on `/overheads`, `/channel-overview` (per store + totals) and `/grid?overheads=1`.
- `tiktok_sku_catalog`: maps TikTok numeric SKU IDs → seller SKUs
- `order_margins` (view): revenue_pence, product_cost_pence, total_cost_pence, margin_pence, margin_percent, price_per_unit_pence, etc.
- `sku_channel_margins` (view): per SKU x channel margins. No longer used by any page (`/grid` reads `order_margins` and aggregates itself)
- Test tenant is looked up by name (`.eq('name', 'Test Store')`) in `lib/importEngine.ts`, `/mappings` and `/tiktok-catalog`. This is what gets replaced when Supabase Auth arrives.

## Code structure
- `lib/supabase.ts`: shared Supabase client
- `lib/importEngine.ts`: shared SKU-matching / dedupe / insert logic. All platform importers must reuse this, not duplicate it (including `/upload`, the generic CSV importer).
- `components/Nav.tsx`: collapsible left sidebar (Dashboards / Import / Manage groups). Rendered for every page by `components/AppShell.tsx` in `app/layout.tsx` (skipped on the public homepage `/`), so pages must NOT include `<Nav />` themselves. Add new pages to `NAV_GROUPS` with a `lucide-react` icon.
- `importEngine` holds back orders whose SKU isn't mapped in the store (listed via `describeImportResult`) unless `createUnknownSkus` is set (tick-box `components/CreateProductsToggle.tsx` on each import page). A store SKU that exactly matches a product's `standard_sku` is still linked automatically.
- `/catalog-import`: bulk products + store mappings from CSV/XLSX (one row per listing). Only adds, never changes or deletes; clashes are reported as problems.
- `/cost-import`: bulk costs from CSV/XLSX (one row per cost; cost_type by label or code; vat_rate and effective_from required, no defaults). Adds only: a different amount for the same product/type/description/date is reported, never overwritten.
- `/costs`: overview of every product's current costs; flags products whose orders have £0 product cost (missing or not-backdated costs) and `shipping_source = 'missing'`. `components/MissingCostsBanner.tsx` shows the same warning above dashboards (via AppShell).
- `lib/readSpreadsheet.ts`: shared CSV/XLSX reader (Papa for CSV to keep exact text, SheetJS for Excel with date-cell conversion). Use it for new file importers.
- `lib/fetchAll.ts`: Supabase silently caps results at 1,000 rows. Any query that can return more (orders, listings, products, catalogs) must go through `fetchAll` with an `.order()` on a unique column + `.range(from, to)`.
- `lib/theme.ts`: shared brand palette + fonts (from the homepage). Use these instead of hardcoding colours.
- Pages: `/grid` (SKU x channel matrix, the styling template), `/channel-overview`, `/sku-detail`, `/margins`, `/trends`, `/upload`, `/amazon-import`, `/tiktok-import`, `/tiktok-catalog`, `/mirakl-import`, `/stores`, `/catalog-import`, `/costs`, `/cost-import`, `/couriers`, `/shipping-profiles`, `/overheads`, `/settings`, `/mappings`, `/products`, `/products/[id]`
- `app/page.tsx`: public holding page. `app/api/subscribe`: Resend signup route.

## Platform import notes
- **Amazon settlement:** multi-row per order; group by order-item-code, revenue = Principal + Tax, costs = ItemFees, use "Shipping label purchase" if present else `shipping_rules`. Refunds and SAFE-T reimbursements not yet handled.
- **TikTok settlement:** one row per line item, uses TikTok numeric SKU IDs → translate via `tiktok_sku_catalog`. Revenue = "Net sales" (already net of seller discounts and same-row refunds); rows with Net sales <= 0 are skipped. "VAT" column is 0 for UK-established sellers (only filled when TikTok collects VAT). Fee VAT = 1/6 of Fees excluding affiliate commission / seller-funded promotion columns.
- **Mirakl:** Excel (.xlsx) settlement export, multi-row per order line; group by "Order line ID". Only sale transaction types are used (Order amount, Shipping charges, Commission and their tax rows). Refunds are skipped for now. Retailer picker lists platforms where `integration_type = 'mirakl'`.
- Document each new channel in `docs/margin-hero-how-to-guide.md`.

## Styling
- Brand palette lives in `lib/theme.ts` (from the homepage): base `#111112`, panels `#1B1C19`, lime accent `#D2FF00`, Mona Sans.
  - Margin tiers are classic red / amber / green: red `#FF4C4C`, amber `#FFB020`, green `#39FF6A`. Always use `marginTier(margin, ranges)` and `marginLegend(ranges)`, never hardcoded cut-offs.
  - Lime is the brand accent only (logo arrow, active nav, buttons). Never use it for margin.
  - Cut-offs are a tenant setting (`tenants.margin_red_below` / `margin_green_from`, defaults 10 / 20, edited on `/settings`). Server pages: `loadMarginRanges()` from `lib/marginRanges.ts`; client pages: `useMarginRanges()` from `hooks/useMarginRanges.ts`. Per-store / per-product ranges are on the roadmap. The homepage mockup uses the defaults.
- The `lib/theme.ts` look is the final style and every page uses it. New pages must too (no hardcoded hex colours outside `lib/theme.ts`, except the Tailwind hover classes in `Nav.tsx`, which must be literal); colour status messages with `statusColor()`. Use `pageStyle` / `eyebrow` / `pageTitle` / `cardStyle` etc., `pounds()` / `percent()` from `lib/format.ts`, and `components/DateRangeBar.tsx` for date ranges. Chart series use `chartRevenue` / `chartProfit` (validated for the dark panel), never the margin tier colours. Pages use inline styles rather than Tailwind classes.

## Roadmap
See `docs/margin-saas-roadmap.md` (Phase 0 MVP → Phase 4 international).
