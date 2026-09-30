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
- **Database changes:** do NOT run SQL against Supabase directly. Write SQL as migration files in `supabase/migrations/` (create the folder if missing) and tell me to run them in the Supabase SQL editor. Views that pages depend on (`order_margins` and `sku_channel_margins`) need extra care. List which pages are affected.
- **Before saying a task is done:** run `npm run build` and fix any TypeScript errors. Vercel builds fail on TS errors.
- **Git:** show me what changed before committing. Use clear commit messages. Don't push without asking.
- **RLS reminder:** real RLS policies and Supabase Auth are deliberately deferred. We're using one test tenant for now. Don't implement them unasked, but remind me when a change makes them more important (e.g. anything going public-facing).

## Money & margin rules (important, these bugs have happened before)
- All money is stored and calculated in **integer pence** (`*_pence` columns). Watch for fractional-penny rounding in VAT splits.
- **Aggregation:** sum totals first, THEN derive percentages from the totals. Never average per-order percentages.
- `margin_percent` uses **net revenue** as the denominator.
- **Gross Profit** = revenue minus landed product cost only (`product_cost_pence`).
- **Net Profit** = revenue minus everything: product cost, other costs, fees, shipping (`total_cost_pence`). Future overhead allocation (wages/rent) will also subtract from Net.
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
- `platforms`: `integration_type` (e.g. `'mirakl'`) is how importers find their platforms
- `order_line_items`: unique on `(platform_listing_id, external_id)` for dedupe on re-uploads
- `cogs_components`, `shipping_rules`
- `tiktok_sku_catalog`: maps TikTok numeric SKU IDs → seller SKUs
- `order_margins` (view): revenue_pence, product_cost_pence, total_cost_pence, margin_pence, margin_percent, price_per_unit_pence, etc.
- `sku_channel_margins` (view): per SKU x channel margins, used by `/grid`
- Test tenant is looked up by name (`.eq('name', 'Test Store')`) in `lib/importEngine.ts`, `/mappings` and `/tiktok-catalog`. This is what gets replaced when Supabase Auth arrives.

## Code structure
- `lib/supabase.ts`: shared Supabase client
- `lib/importEngine.ts`: shared SKU-matching / dedupe / insert logic. All platform importers must reuse this, not duplicate it. Known exception: `/upload` (generic CSV) still has its own dedupe/insert and should be moved onto importEngine at some point.
- `components/Nav.tsx`: collapsible left sidebar (Dashboards / Import / Manage groups). Rendered for every page by `components/AppShell.tsx` in `app/layout.tsx` (skipped on the public homepage `/`), so pages must NOT include `<Nav />` themselves. Add new pages to `NAV_GROUPS` with a `lucide-react` icon.
- `lib/theme.ts`: shared brand palette + fonts (from the homepage). Use these instead of hardcoding colours.
- Pages: `/grid` (SKU x channel matrix, the styling template), `/channel-overview`, `/sku-detail`, `/margins`, `/trends`, `/upload`, `/amazon-import`, `/tiktok-import`, `/tiktok-catalog`, `/mirakl-import`, `/mappings`, `/products`, `/products/[id]`
- `app/page.tsx`: public holding page. `app/api/subscribe`: Resend signup route.

## Platform import notes
- **Amazon settlement:** multi-row per order; group by order-item-code, revenue = Principal + Tax, costs = ItemFees, use "Shipping label purchase" if present else `shipping_rules`. Refunds and SAFE-T reimbursements not yet handled.
- **TikTok settlement:** one row per line item, uses TikTok numeric SKU IDs → translate via `tiktok_sku_catalog`. Revenue = "Net sales" (already net of seller discounts and same-row refunds); rows with Net sales <= 0 are skipped. "VAT" column is 0 for UK-established sellers (only filled when TikTok collects VAT). Fee VAT = 1/6 of Fees excluding affiliate commission / seller-funded promotion columns.
- **Mirakl:** Excel (.xlsx) settlement export, multi-row per order line; group by "Order line ID". Only sale transaction types are used (Order amount, Shipping charges, Commission and their tax rows). Refunds are skipped for now. Retailer picker lists platforms where `integration_type = 'mirakl'`.
- Document each new channel in `docs/margin-hero-how-to-guide.md`.

## Styling
- Brand palette (from `/grid`):
  - Base `#1A1A1A`, panels `#232323`
  - Margin tiers: fluro red `#FF4C4C` (under 10%), lime `#DCFF00` (10–20%), fluro green `#39FF6A` (20%+)
  - Lime `#DCFF00` is also the brand accent (logo arrow, active nav link)
- `/grid` is the reference design; carry its visual language to other pages. Existing pages use inline styles rather than Tailwind classes.

## Roadmap
See `docs/margin-saas-roadmap.md` (Phase 0 MVP → Phase 4 international).
