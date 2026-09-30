# Margin Calculator SaaS — Build Roadmap

**Product**: Multi-tenant margin/profit calculator for UK e-commerce sellers across Amazon, eBay, Mirakl retailers (B&Q, The Range, Debenhams, Tesco), OnBuy, Temu, TikTok — expanding to EU/US marketplaces later.

---

## Foundational decisions (locked in, don't revisit these)

- **Multi-tenancy**: Postgres Row-Level Security, every tenant-scoped table carries `tenant_id`.
- **Primary keys**: UUIDs everywhere (no sequential IDs — avoids leaking volume, safe for multi-server generation, plays well with future data merges).
- **Money**: stored as integers in minor units (pence/cents), never floats. Every monetary row also carries `currency_code`.
- **Extensibility pattern**: fees, COGS, and shipping are "type tables" (a `type` column + row per cost), not fixed columns — new cost types are new rows, not migrations.
- **Tax**: `tax_regime_id` on tenants and on per-product rates (not a flat VAT boolean) — supports VAT, GST, US sales tax, zero-rated products, without restructuring.
- **Dedupe**: `external_id` uniqueness constraint on order line items from day one — prevents double-counting on re-uploaded/overlapping CSV ranges.
- **Standardised SKU**: `master_products` ↔ `platform_listings` — one canonical product, many platform-specific SKUs. This is the core reporting join for everything else.

---

## Before real customers (blockers — don't launch without these)

- **Supabase Auth + real RLS policies.** Currently deferred: there's one test tenant, looked up by name (`'Test Store'`). Every tenant-scoped table needs policies, including `stores`, `tiktok_sku_catalog`, `master_products`, `platform_listings`, `order_line_items`, `cogs_components`, `shipping_rules`, and the `order_margins` / `sku_channel_margins` views. Replace every `'Test Store'` lookup with the logged-in user's tenant.
- ~~**Move the generic CSV upload (`/upload`) onto `importEngine` and give it a store picker.**~~ Done 2026-09-30.

---

## Phase 0 — MVP (CSV-based, single platform proof of concept)

**Goal**: prove the margin calculation is correct end-to-end for one seller, one platform.

- Tenant setup, user auth, VAT/tax regime selection
- `master_products` + manual SKU mapping UI (standardisation feature)
- CSV upload for **Amazon only** (most standardised settlement report format) + `column_mappings` table so users map once, not per upload
- `import_batches` table for upload history/reprocessing
- Manual entry: `cogs_components` (cost price only), `shipping_rules` (per-exact-quantity pricing, not banded ranges — one row per qty, e.g. qty 1 = £3.99, qty 2 = £3.99, qty 3 = £5.99)
- **COGS entry UI safeguard**: when building the real "add a cost" screen (replacing manual SQL entry), the VAT rate field must not default to a value (e.g. 20%) — force a deliberate choice each time (0% for VAT-free imports/in-house labour, 20% for VAT-registered UK/EU suppliers, etc.). A hidden default risks silently overstating or understating margin per product, since VAT treatment varies per purchase, not per tenant.
- Core margin calc: `sale_price − fees (from CSV) − cogs − shipping`, net/gross branching by tax regime
- Basic table/list view of margin by order and by SKU — no dashboard polish yet

**Exit criteria**: a real seller can upload a settlement report and get a trustworthy per-SKU margin figure they'd act on.

---

## Phase 1 — v1 (multi-platform CSV + the dashboard)

This is where the product actually becomes usable daily, so the dashboard work matters as much as the data plumbing.

**Data**
- CSV import for eBay, Mirakl retailers, OnBuy, Temu, TikTok — one parser + column mapping per platform
- `ad_spend` import (manual or CSV) for ACOS/TACOS
- Per-product VAT/tax rates (zero-rated handling)
- **Dashboard performance at scale**: dashboards currently download every order line (in 1,000-row pages via `lib/fetchAll.ts`) and add them up in the browser. Fine for tens of thousands of lines; before sellers have hundreds of thousands, move the totals into the database (aggregated views or Postgres functions grouped by product × store × date) so pages download summaries, not raw rows.
- **Date-tracked VAT registration per store**: `vat_registered` is currently a simple yes/no on `stores`, so ticking it recalculates *all* of that store's past orders as if it had always been registered. Store it with an `effective_from` date (same pattern as `cogs_components` / `shipping_rules`) so orders before the registration date keep the non-registered treatment. Useful when a new brand launches unregistered and registers later.

**Costs build-out (the crux of margin; do in this order)**

Manage menu target: Stores · Products · Mappings · Catalog Import · Costs · Shipping · Overheads.

Costs behave in three different ways, and the model needs all three:
1. **Per unit.** Landed cost, most WEEE compliance fees. These scale with quantity (how `cogs_components` works today).
2. **Per order / per parcel.** Box, pick & pack fee, label. Charged once per order however many units it holds. Not modelled yet: entering these as product costs wrongly multiplies them by quantity, which distorts bundles and multi-quantity orders.
3. **Per period.** Wages, rent, business rates, utilities, subscriptions, the annual WEEE registration fee. Shared out across products at reporting time (default: each product's share of revenue; alternatives: share of units or orders).

Steps:
1. ✅ **Costs overview + missing-costs warning.** (Done 2026-09-30.) One table of every product's current costs, flagging products whose orders have no product cost (they silently show ~100% margin), including costs dated *after* some orders that need backdating. Warning banner on dashboards.
2. ✅ **Fixed cost types + per-order costs.** (Done 2026-09-30: `cost_types` table, all-in landed cost or broken down, per-order charged once per order *line*. Later: store the order number on each line so a multi-product order is charged its box once.) Replace free-text `component_type` with a fixed list (landed cost, pick & pack, packaging, WEEE, other…) so reports can break costs down by type; add per-order costs (per the modelling point above).
3. ✅ **Bulk cost import.** (Done 2026-09-30: `/cost-import`.) Same style as Catalog Import: CSV/XLSX, adds only, dated, deliberate VAT rate per row (no default).
4. **Shipping rate cards.** Define a courier service once ("Evri small parcel = £2.95", per-quantity and bundle prices) and assign products to it, instead of per-product shipping rows. Price change = one edit, dated. Also decide the fallback when an order quantity has no matching rate.
5. **Overheads + allocation.** `overhead_costs` (name, amount, period) and the allocation rule above, subtracted in Net Profit only (never Gross).

**Dashboard (priority)**
- **Overview page**: total revenue, total margin, margin %, order count — filterable by date range, defaulting to "last 7 days" and "this month"
- **SKU × channel comparison view**: the standardised SKU as rows, platforms as columns, margin % per cell — this is your headline differentiator over single-platform tools like Sellerboard, so it deserves real design attention, not a bolted-on table
- **Trend charts**: margin over time per SKU, per platform, per tenant total
- **Clean layout principles**: one primary number per screen (net profit), secondary metrics demoted visually, no more than 2-3 colours carrying meaning (good/bad/neutral margin)

**Alerts** (cheap once the data model exists, high daily-engagement value)
- Margin % drops below a user-set threshold for a SKU
- A SKU's margin goes negative
- A fee rate changes between imports (flag for review)
- No sales recorded for an active listing in N days (possible stock/listing issue)
- Delivered via in-app notification first; email next (transactional email service — Resend, Postmark, or SES), Slack later

**Exit criteria**: a seller opens the dashboard regularly (not just after uploading a CSV) because alerts and the cross-channel view give them a reason to check in.

### Dashboard layout (mockup reference)

Top to bottom: summary metric cards (revenue, net margin, margin %, order count) → alerts list (red for negative margin, amber for warnings like a fee increase) → SKU × channel margin grid, colour-coded per cell (green/amber/red), with "—" for SKU not yet listed on that channel.

Design decisions to make before/during build:

- **User-set margin colour ranges (red / amber / green).** Currently hardcoded at under 10% red, 10–20% amber, 20%+ green (`marginTier()` in `lib/theme.ts`). Build in stages:
  1. **Overall (first):** a tenant setting for the two cut-offs (e.g. red below 12%, green from 25%), used by every dashboard and the grid.
  2. **Per store (later):** override for a store where margins are naturally different (e.g. TikTok with high fees).
  3. **Per product (future):** override for individual products, e.g. a high-volume commodity line that's healthy at 8%.
  Most specific wins: product → store → overall.
- **Colour thresholds are per-tenant, not hardcoded** — a 10% margin might be fine for a high-volume commodity product, bad for a niche one. Let tenants set their own green/amber/red cutoffs.
- **Empty cells ("—") are an expansion signal** — a SKU not listed on a channel could later become a soft CTA ("not yet listed here").
- **Grid needs sort/filter** — by lowest margin, by channel, by category — to stay useful once a tenant has more than a handful of SKUs.
- **Bundle SKUs need visual distinction** — a bundle has different shipping economics to a single unit; the grid should make clear when a margin figure reflects a bundle sale vs a single sale, or the swing looks like an error.

---

## Phase 2 — v2 (API sync + reimbursements)

- Swap CSV uploads for live API sync (Amazon SP-API, eBay, etc.) — the schema doesn't change, just the ingestion path into `order_line_items` / `ad_spend`
- Real-time "today" view (Sellerboard's strongest feature — orders/profit as they land)
- Reimbursement/discrepancy detection: compare what a platform *should* have paid (per fee_rules + order data) against what actually landed — flag shortfalls
- `fee_rules` engine goes live for **pre-sale forecasting** ("if I list at £X, what's my margin?") — separate from the CSV-derived actual fees used for historical reporting

---

## Phase 3 — margin depth (the Sellerboard differentiator layer)

Deliberately scoped to margin only — resist pressure to add inventory management, review automation, or listing optimisation even as competitors bundle these in. Depth on margin is the differentiator, not breadth of features.

- **Contribution margin tiers (CM1/CM2/CM3)** per SKU, not just one profit number:
  - CM1 = revenue − COGS − platform fees (is the product itself viable?)
  - CM2 = CM1 − ad spend (can you afford to acquire customers on this SKU?)
  - CM3 = CM2 − fulfilment/storage/returns (the real bottom line)
  - Shows *where* margin leaks, not just that it's thin
- **Break-even ACOS per SKU** — max ad spend % before the SKU stops being profitable, calculated from existing fee/COGS/margin data
- **Pre-listing what-if simulator** — model margin at a hypothetical price/fee/ad-spend combination before committing to a listing, using the `fee_rules` engine already built for pre-sale forecasting in Phase 2
- **Margin sensitivity view** — show margin impact of a % change in COGS, ad spend, or shipping cost — useful for supplier/courier negotiations
- **Category/channel benchmarking** — compare a tenant's margin against anonymised aggregate benchmarks once enough tenant data exists
- **Accounting export** — clean margin-by-period export for Xero/QuickBooks reconciliation (not full sync like A2X — just a trustworthy figure an accountant can check against)

### Product model enhancements (also Phase 3 candidates)

- **Overhead cost allocation** (wages, utilities, rent, etc.) — structurally different from COGS/fees/shipping, since it's only meaningful relative to a time period's total sales, not known per order. A `overhead_costs` table (tenant-level: name, amount_pence, period_start, period_end) with allocation calculated at reporting time: `SKU's share = (SKU revenue ÷ total revenue for period) × total overhead for period`. Lives in a summary/reporting query, not the core per-order margin view.
- **Parent SKU + variants** — a nullable self-referencing `parent_product_id` on `master_products`, letting variants (e.g. different sizes/colours of one product) roll up under one parent for combined reporting while keeping independent pricing/cost/mapping per variant. Cheap, additive, no restructuring needed.
- **Product attributes for reporting** (size, colour, material, etc.) — a flexible `product_attributes` table (master_product_id, attribute_name, attribute_value), same "type table" pattern as COGS, so any attribute can be added without a schema change. Enables slicing margin reports by attribute (e.g. "margin by colour," "margin by size") — answers questions like whether red XL t-shirts outperform small blue ones.

## Phase 3.5 — mobile app & push alerts

Push notifications require either a native/installed app or web push — this is an architecture decision worth making once the core web dashboard is stable, not before.

- **Fastest path**: PWA (progressive web app) — the existing web dashboard becomes installable on a phone home screen and supports push notifications via the browser, without building/maintaining separate iOS and Android codebases
- **Fuller native path**: React Native or similar, if app-store presence or deeper device integration matters for growth/marketing later
- Push alert types mirror the in-app alerts already defined (negative margin, fee change, threshold breach) — same alert engine, new delivery channel
- Decide notification frequency/batching early (real-time per event vs daily digest) — too many pushes trains users to ignore them

## Phase 4 — v3 (international expansion)

- New `platforms` rows per marketplace (Amazon DE/FR/ES, Walmart US) — no schema change, just data
- **Non-GBP stores (e.g. Amazon FR in EUR)**: stores can already be created on any platform, but all import and margin maths assumes GBP. Needed: importers record each order's real `currency_code` (column already exists on `order_line_items`, defaults to GBP), COGS/shipping costs can be in a different currency from the sale, and the views convert to the tenant's reporting currency before summing (never sum mixed currencies). Store-specific shipping rules already support a different courier cost per country.
- Exchange rate capture per transaction (`exchange_rate_to_tenant_currency`, `rate_date`) for accurate historical reporting
- Additional `tax_regimes` (US sales tax, EU VAT variants)
- Reporting currency toggle: consolidated tenant-currency view vs per-market breakdown
- FIFO/weighted-average COGS (inventory lots) if stock purchase price varies over time — bigger schema addition, worth scoping separately when it's actually needed

---

## Open product decisions (not urgent, but worth deciding before you hit them)

- Reporting currency default: consolidated vs per-market
- Alert delivery channels beyond in-app (email, Slack, SMS)
- Whether forecasting (pre-sale margin) is a separate paid tier feature
- Shipping rules UI: don't pre-populate a large range of quantity rows — let users add rows only for quantities they actually sell at, and decide the fallback behaviour when an order quantity has no matching row (e.g. use the highest defined quantity's cost as a default)
- Platform fee VAT handling isn't universal: Amazon UK settlement reports don't break out VAT on fees (currently derived by assuming a flat 20% VAT-inclusive rate at import) — other platforms may report this differently or not charge fee VAT at all, so each platform's import logic needs its own check when built, rather than reusing the Amazon assumption
