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

- ~~**Supabase Auth + real RLS policies.**~~ Done 2026-10-04: `/login` (no sign-up), `proxy.ts` redirect, `tenant_members` + `current_tenant_id()`, one `tenant_isolation` policy on every table, views use `security_invoker`, anon has no access, no more `'Test Store'` lookups. Checked with a second test tenant: each user sees only their own data.
- **Still to do before real customers:**
  1. Remove or hide testing-only tools: `/order-lines` (unlisted, has **Delete selected** for order lines), or restrict them to an admin user. RLS now limits its deletes to your own tenant (the old `dev_allow_delete_TEMPORARY` policy was dropped by the lock-down), but customers still shouldn't have it.
  2. Sign-up / onboarding: new customers are currently created by hand (Supabase user + `tenants` row + `tenant_members` link). Needs a sign-up flow that does all three, plus password reset.
  3. Tidy-up: Couriers, Shipping Profiles, Overheads and Catalog Import still send a `tenant_id` they looked up themselves; switch them to the database default like Stores and Mappings.
  4. **Plan limits and upgrades (added 2026-10-05).** Nothing tracks plans or usage yet. When a customer reaches their plan's order limit, imports stop but everything already imported stays visible, and the app offers an upgrade. Needs:
     - **Plans:** a `plans` table (name, order limit, price) and `plan_id` on `tenants`. Keep it in step with `lib/pricing.ts` (Solo £9 / 250, Starter £24 / 2,000, Growth £44 / 6,000, Scale £79 / 20,000, Enterprise custom; decided 2026-10-06, Solo added for small TikTok / Temu / Etsy sellers).
     - **Grace month (Solo especially):** going over the limit once (e.g. one viral TikTok week) gets one month's grace with a nudge before imports stop.
     - **Founding-member pricing (idea):** waitlist sign-ups keep their launch price for life (or a set period), as a reason to join early.
     - **Usage count:** already defined on the pricing page as *orders, not line items, over a rolling 30 days*, so count distinct orders (`external_id` per store), not `order_line_items` rows. Only count rows actually inserted, so re-uploads that are deduped don't use up the allowance.
     - **Check in `lib/importEngine.ts`:** every importer goes through it. Before inserting, compare the upload with the remaining allowance. Either reject it with a clear message, or import up to the limit and list the rest as "not imported, upgrade to add".
     - **Database guard:** a trigger (or policy) that blocks inserts past the limit, because checks in the browser can be bypassed.
     - **Read-only mode:** dashboards and Manage pages keep working; only the import pages swap the upload button for an upgrade prompt.
     - **Upgrade flow:** Stripe Checkout / customer portal, with a webhook that updates `plan_id` on payment.
     - **Early warning:** an in-app nudge at about 80% of the limit (email later), so the lock-out is never a surprise.
     - **Decide first:** does the rolling 30 days use the *order date* or the *upload date*? By order date, a new customer back-filling a year of history isn't locked out in week one. Probably also allow a one-off history import on sign-up.
  5. **Data protection and legal (added 2026-10-06).** UK GDPR + Data Protection Act 2018 (personal data) and PECR (marketing emails, cookies). Margin Hero is the **controller** for users' own details and waitlist emails, and a **processor** for the business data customers upload. Not legal advice: check with a solicitor or the ICO's small-business guidance.
     - **FILL IN `lib/company.ts` FIRST:** the public footer (homepage, pricing, privacy) has been live since 2026-10-06 showing `[placeholder]` business details. Fill in every value, then check the footer and `/privacy` (the Draft banner disappears when all are filled).
     - **ICO data protection fee:** register and pay (small yearly fee), then put the registration number in `lib/company.ts`.
     - **Privacy notice:** drafted at `/privacy` (linked from the footer and the waitlist form) and reads its details from `lib/company.ts`. Fill in every `[placeholder]` (legal name, company number, where registered, address, contact email, ICO number, Supabase region, account retention) before it goes live: the page shows a "Draft" banner until then. **Needed now, not just at launch, because the waitlist already collects emails.**
     - **Supabase region:** check it (dashboard → Project Settings). UK/EU is simplest; if US, the transfer is covered by Supabase's DPA (UK addendum) and the privacy notice must say so.
     - **Sub-processor DPAs:** accept Supabase's, Vercel's and Resend's data processing agreements, and keep the sub-processor list in the privacy notice up to date.
     - **Terms of service with a Data Processing Agreement** for customers' uploaded data (needed before paid plans; add `/terms` to the footer, `PUBLIC_PAGES` and `OPEN_PATHS`).
     - **Account deletion and export:** delete a closed account's data within the stated retention period, and be able to export or delete a customer's data on request (answer within one month).
     - **Breach plan:** one page on what to do; serious breaches go to the ICO within 72 hours.
     - **Security basics:** two-factor login on Supabase, Vercel, GitHub and Resend; check the Supabase plan's backups; service-role key server-side only (already so); RLS (done).
     - **Keep imports free of buyer personal data:** importers read files in the browser and store only order / product references, dates, quantities and amounts. Every new importer must keep it that way (the privacy notice promises it).
     - **Cookies:** only the login cookie and display preferences in the browser today, so no banner is needed. Adding analytics or ad tracking means a consent banner first (or a cookie-free analytics tool) and a privacy notice update.
     - **Marketing emails:** only to people who opted in, with an unsubscribe link in every email.
     - **Sample files from sellers:** ask for buyer details removed, delete once the importer works, never commit them to the repo.
- ~~**Move the generic CSV upload (`/upload`) onto `importEngine` and give it a store picker.**~~ Done 2026-09-30.
- ~~**TikTok sale VAT for VAT-registered stores.**~~ Done 2026-10-02 (importEngine works it out from the product's VAT rate; OnBuy uses the same). Original note: TikTok settlement reports show £0 VAT for UK-established sellers (TikTok only fills it when it collects the VAT itself), so the importer records the whole sale as net revenue. For a VAT-registered store that overstates revenue and margin by the VAT. Fix: when the report's VAT is £0 and the store is VAT registered, work out the VAT from each product's VAT rate (`master_products.vat_rate`) at import time.
- **Refunds dashboard (added 2026-10-06, before launch).** A page of its own for refunds: cost of refunds, worst SKUs, refund rate by store, trend. Full spec: **Refunds dashboard** in Phase 1. Build once refunds from one or two more channels are in, so it can compare stores.
- **Refunds and returns.** Amazon done 2026-10-06 (see Phase 1). Other importers still skip refund rows (Amazon refunds and SAFE-T reimbursements, TikTok refund-only rows, Mirakl refund types), so revenue and margins are overstated for any product that gets returns. Needs: importing refunds as their own lines linked to the original sale (by order / order-line ID), the refunded revenue and refunded fees, whether the item came back resaleable (cost recovered) or not (cost lost), and showing refund rate per SKU per store. Full plan: **Refunds and returns** in Phase 1.

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
- Ad spend import, see **Advertising** below
- Per-product VAT/tax rates (zero-rated handling)
- ✅ **Fees broken down by type** (done 2026-10-06): `order_line_fees` keeps each order line's fees by type (commission, fulfilment, payment, shipping, advertising, affiliate, other, not broken down) plus the channel's own fee name. Amazon, Mirakl, OnBuy (sales fee vs Boost) and Shopify split fully; TikTok only splits affiliate / seller-funded promotion so far. Orders imported before this are "Not broken down". Still to do: map TikTok's own fee columns (commission, transaction fee, etc.) from a real file; a fee report (fees as % of sales by type, per store, over time); use the `advertising` / `affiliate` rows when building **Advertising**.
- **Payment fee settings (PayPal etc.)** (added 2026-10-05): some fees never appear in a channel's files, e.g. PayPal on Shopify orders (Shopify only reports its own Shopify Payments fees). Let users enter each payment provider's rate per store (% + fixed fee per transaction, plus the fee's VAT, since rates differ by PayPal account type and volume), date-tracked with `effective_from` like other costs. The importer (or the view) applies it to orders whose payment method matches and that have no reported fee; currently they count as £0.
- **New channels without an account of our own (added 2026-10-06)** (e.g. Etsy):
  - **Draft from public information:** the channel's help pages on its exports, its API docs (field names usually match the CSVs), accounting connector guides (A2X, Link My Books) for how fees, VAT and payouts work, and seller forums.
  - **Confirm with one real file:** a redacted single-order export from a waitlist seller on that channel (e.g. a free month or two in return). Exact column names, signs, date formats and VAT treatment only come from a real file.
  - **"Beta" label** on the homepage channel list for importers built from documentation only, until a real file confirms them (then "Live").
  - **"Request your channel"** in the app: a user picks a channel that isn't supported yet (or a report type that isn't handled, e.g. refunds) and uploads a sample report. Before upload, the app shows how to remove buyer names and addresses and asks for consent to use the file to build the importer. Stored privately (Supabase Storage, admin-only, not readable by other tenants) and deleted once the importer is built. Also shows which channels have been requested most, to decide what to build next. Until it exists, the generic CSV / Excel upload covers any channel.
- **Large / historic imports (added 2026-10-06)**: a new customer may want to load several years of history (e.g. 3 years of Amazon = ~80 fortnightly settlement reports). No hard row limit is needed: imports already save in batches of 500 and re-uploads are deduped, so a half-finished import can just be uploaded again. What's missing:
  - **Several files at once** (pick a folder's worth of settlement reports), imported one after another with a progress bar ("file 12 of 80, 41,000 lines").
  - **Very big files**: everything runs in the browser, so a huge file (hundreds of thousands of rows) could be slow or run out of memory. Read and import it in slices; if that isn't enough, move imports to a background job on the server that carries on if the tab is closed.
  - **Import history** (the `import_batches` table in Phase 0): which files went in, when, how many lines, so a user can see which periods are covered and spot gaps.
  - **Plan limits**: a historic import counts towards the order limit (see **Plan limits and upgrades** above). Decide whether history before the sign-up date counts, or gets a one-off allowance, so a big back-catalogue doesn't push a new customer straight onto a higher plan.
  - Pairs with **Dashboard performance at scale** below: years of history means hundreds of thousands of lines on the dashboards.
- **Dashboard performance at scale**: dashboards currently download every order line (in 1,000-row pages via `lib/fetchAll.ts`) and add them up in the browser. Fine for tens of thousands of lines; before sellers have hundreds of thousands, move the totals into the database (aggregated views or Postgres functions grouped by product × store × date) so pages download summaries, not raw rows.
- **Date-tracked courier changes (added 2026-10-06)**: e.g. a seller switches from Evri to DPD. Courier *prices* are already dated (`courier_service_prices.effective_from`), but the courier *choice* isn't: `shipping_profile_bands` and `product_shipping_profiles` have no dates. So today, pointing a profile's bands at DPD (or reassigning products to a new DPD profile) recalculates **all past orders** with DPD, and orders dated before the first DPD price find no price and show as "missing shipping". The only workaround is adding DPD's price as a new dated price on the Evri service (right numbers, wrong label).
  - **Fix:** version each profile's band set with an `effective_from` (existing bands become the first version, dated from the beginning, so no figures change). `order_margins` picks the band set in effect on the order date. Re-create `margin_lines` after changing `order_margins`.
  - **UI on `/shipping-profiles`:** "Change courier from [date]" copies the current bands into a new version for the user to point at the new services (one change covers every product on the profile). Keeps the Edit (fix a mistake, retroactive) vs Add / Change from date (real change, history kept) rule.
  - **Second step:** date which profile a product uses (`product_shipping_profiles`), e.g. a product moving to a bigger box from March.
  - **Until then:** a warning on `/shipping-profiles` not to change a profile's courier for a real switch.
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
4. ✅ **Shipping rate cards.** (Done 2026-10-01 as a courier price list + shipping profiles: qty bands → N parcels × courier service, prices dated on the courier service, per-product profile with per-store exceptions or "no shipping cost". Later: date the profile bands themselves; bulk "raise courier X by n% from date"; shipping spend by courier report.)
5. ✅ **Overheads + allocation.** (Done 2026-10-01: `/overheads` with recurring weekly / 4-weekly / monthly / quarterly / yearly or one-off spread over N months; whole business or one store; shared by revenue (default), units or orders; shown on Channel Overview and the Grid's "After overheads" view. Later: other dashboards, per-category reports, importing overheads from accounting software.) `overhead_costs` (name, amount, period) and the allocation rule above, subtracted in Net Profit only (never Gross).

**Advertising (ad spend in margin)**

Ads are often the single biggest cost after the product itself, and a SKU can look healthy on Net margin while losing money once its ad spend is counted. Scope is strictly *what ads do to margin*: no campaign management, bidding or keyword tools (the homepage promises "No PPC bidding").

- **Data:** an `ad_spend` table: tenant, store, date, campaign name, optional SKU (`master_product_id`), spend in pence, VAT rate, attributed sales in pence. Dated per day so any dashboard range works.
- **Sources, one importer each (reusing `lib/readSpreadsheet.ts`):**
  - Amazon Sponsored Products / Brands: the "Advertised product" report (spend and sales per SKU per day)
  - TikTok Shop ads (GMV Max, Promote). Creator affiliate commission is already counted in TikTok fees, so it mustn't be counted again here.
  - Retail media where the Mirakl retailers offer it, plus Google / Meta ads for Shopify and other own-site stores
  - Manual entry for anything else (e.g. a one-off influencer fee)
  - **Per-sale ad fees already in order reports:** OnBuy **Boost** (columns "Boost Fee %", "Boost Fee Per Item £" = net, "Boost Fee TAX Per Item £" = VAT, "Total Boost Fee"). Tied to one order line, so it's SKU-level spend with attributed sales = that sale. Currently imported as part of OnBuy fees; move it to ads when this layer is built. eBay Promoted Listings (Standard) works the same way.
- **Allocation:**
  - Spend tied to a SKU goes to that SKU in that store.
  - Campaign- or store-level spend with no SKU is shared across that store's sales for the period, by revenue (the same per-day sharing already used for overheads in `lib/overheads.ts`).
- **Metrics:**
  - **ACOS** = ad spend ÷ ad-attributed sales
  - **TACOS** = ad spend ÷ *total* sales (the one that shows whether ads are paying for themselves)
  - **ROAS** = ad-attributed sales ÷ ad spend
  - **Break-even ACOS per SKU** = its net margin before ads (moved here from Phase 3 since the data makes it trivial)
  - All are sums first, then ratios, per the aggregation rule.
- **Where it shows:**
  - **Net profit after ads** on Channel Overview, SKU Detail and the Grid (an "After ads" view alongside "After overheads").
  - Ad spend as a line in the cost breakdown.
  - An alert when a SKU's TACOS pushes its margin below the user's red threshold.
- **Margin order:** Gross (landed cost) → Net (fees, shipping, other costs) → **after ads** → after overheads. Ads never touch Gross.
- **Per-channel checklist (decided 2026-10-03: leave ad costs where they are until this is built, then move them all in one go).** For each importer, check what ad cost is already inside "fees" today, move it to ads, and make sure it's never counted twice:
  - **OnBuy:** Boost is inside fees today ("Total Fees Inc. TAX £" includes it). Move out: "Boost Fee Per Item £" (net, or "Total Boost Fee" for the line) + "Boost Fee TAX Per Item £" (VAT). "Boost Fee %" (set per SKU, e.g. 20%) is worth showing next to the SKU. Existing OnBuy orders will need re-importing to split it out.
  - **TikTok:** fees today include affiliate commission (incl. "Affiliate Shop Ads commission") and promotion-type fees (e.g. Smart Promotion fee). Decide which are advertising vs selling fees. GMV Max / Promote ads are billed separately: import those from the ads report.
  - **Amazon:** settlement fees (ItemFees) don't include Sponsored Products / Brands spend: import it from the Advertised product report.
  - **Mirakl retailers (B&Q, The Range, Debenhams, Tesco):** commission only today, no ad cost in the transaction report. Add retail media spend if/when used.
  - **eBay:** Promoted Listings (Standard) is a per-sale fee like OnBuy Boost: split it out when the eBay importer is built.
  - **CSV / Excel upload (Argos, Shopify, others):** no ad cost column today. Shopify / own-site ads come from Google / Meta reports or manual entry.
- **Pricing:** included on every plan, like everything else.

**Refunds and returns (its own piece, added 2026-10-03)**

Progress (2026-10-06): **Amazon refunds done.** `order_refunds` table (linked to the sale by `original_external_id`, so no need for the sale to be imported first), refund fees in `order_line_fees`, return labels, and the `margin_lines` view (sales + negative refund rows) behind Channel Overview, Margins, SKU Detail, Trends, Opportunities and /order-lines. Refund rate (refunded units ÷ units sold) on Channel Overview (per store) and SKU Detail. Items are assumed resaleable for now (decided 2026-10-06: tracking each return's condition relies on sellers updating it, so it's its own later piece; the refund rate is the main flag). Still to do: TikTok, Mirakl, OnBuy, Shopify refunds (need an example refund file from each), SAFE-T reimbursements, refund % sort on Margins, a Refunds dashboard, refund-rate alerts, resaleable / written-off per return.

Returns quietly eat margin, and some SKUs are far worse than others. Scope: what refunds do to margin, plus a **refund % per SKU** so the problem products stand out.

- **Data:** refunds as their own lines linked to the original sale (order / order-line ID, SKU, store, refund date), with refunded revenue, any fees the channel gives back or keeps, and VAT. Dated by refund date so any dashboard range works.
- **Was the item resaleable?** Back in stock (product cost recovered) or written off (product cost lost); a default per store, editable per refund. Plus return postage / restocking costs where the seller pays them.
- **Sources, per importer** (all currently skip refund rows):
  - Amazon: refund rows and SAFE-T reimbursements in the settlement report
  - TikTok: refund-only rows (same-row refunds are already netted into "Net sales")
  - Mirakl (B&Q, The Range, Debenhams, Tesco): "Order amount refund", "Shipping charge refund", "Commission refund" and their tax rows
  - OnBuy: refund rows in the transaction report (currently skipped as non-sales)
  - CSV / Excel upload: a refund column or refund rows
- **Metrics** (sums first, then ratios):
  - **Refund % by SKU** = refunded units ÷ units sold (also by value: refunded revenue ÷ revenue), per store and across all stores
  - Net profit after refunds; cost of returns per SKU
- **Where it shows:** a refund % column / sort on Margins, a Refunds dashboard (worst SKUs first, see below), the order-line breakdown, and an alert when a SKU's refund % passes a threshold.
- **Refunds dashboard (before launch, added 2026-10-06).** Its own page under Dashboards, answering "which products are costing me money through returns, and how much?" Reads `margin_lines` (refund rows + their linked sales); sums first, then ratios. Date range bar like the other dashboards.
  1. **Headline tiles for the period:** £ refunded, units refunded, overall refund rate, and **cost of refunds** = profit lost on the refunded sales + return postage + fees the channel kept (the LL-1 example: about £9 per return). This is the number that matters most.
  2. **Worst SKUs table:** product × store, with units sold, units refunded, refund rate, cost of refunds £. Sortable, worst first. Coloured by a refund-rate threshold (a tenant setting like the margin colour ranges, e.g. green under 3%, red over 8%), never the margin colours' meaning.
  3. **Refund rate by store:** the same product often returns far more on one channel than another.
  4. **Monthly trend:** £ refunded and refund rate by month (chart series colours, not margin tiers), to spot a product getting worse, e.g. a bad batch.
  5. **Timing:** typical days from sale to refund per SKU, and when a month's figures can be treated as final (see **Refund lag reporting** above).
  6. **Data quality notes:** refunds whose sale isn't imported (units estimated), goodwill partial refunds (money back, 0 units), unmatched return labels, and channels whose refunds aren't imported yet (so a 0% isn't mistaken for "no returns").
  - **Later, with new data:** return **reasons** ("defective", "not as described", "changed mind") from Amazon's Returns report (not in the settlement report) and the other channels' equivalents. Turns "12% refund rate" into "12%, mostly damaged in transit", which tells the seller whether to fix packaging, the listing or the supplier.
  - **First version** could be items 1, 2 and 6 (all from data already stored); 3 to 5 follow as more channels' refunds arrive.
- **Margin order:** refunds reduce revenue and Net profit for the period they happen in. Gross only changes when the product cost is lost (item written off).
- **Refund lag reporting (added 2026-10-06).** Refunds count when they happen, and each refund is linked to its sale, so the gap between them can be reported:
  - **Days from sale to refund**, by SKU and by channel: average and spread (e.g. "most LL-1 returns come back 8 to 14 days after the sale").
  - **How long until a month's figures settle**: what share of refunds arrive within 7 / 14 / 30 / 60 days, so a seller knows when last month's margin is final.
  - **Expected refunds for recent sales**: use each SKU × channel's past refund rate and lag to show the likely refunds still to come on recent sales, as a "provisional" margin for the last few weeks alongside the actual one.
  - Spotting changes: a SKU whose returns start arriving sooner or more often than usual (e.g. a faulty batch) as an alert.
  - Only refunds whose sale is imported have a lag; the rest are left out of these figures (and counted, so the user knows).

**New product margin checker (added 2026-10-06)**

Before buying stock or listing a new product, the seller enters the numbers and sees straight away whether it makes money in each of their stores. Scope: a quick "does this product work?" answer, not stock or sourcing tools.

- **Inputs:** product name (optional), landed cost per unit (or product cost + inbound freight + import duty), VAT rate on the sale, the planned selling price (one price for all stores, or per store), units per sale (for bundles/multipacks), and optionally a shipping profile or a shipping cost per order.
- **Per store it works out:** revenue net of VAT (or VAT as a cost if the store isn't VAT registered), estimated channel fees, shipping, and then Gross profit, Net profit (£ per sale) and margin % (Net profit ÷ net revenue), coloured with the tenant's red / amber / green ranges (`marginTier()`).
- **Where the fee estimate comes from (no fee rules engine needed):** each store's real average fee % from orders already imported (total fees ÷ total revenue, summed first, over e.g. the last 90 days). Stores with no sales yet use a fee % the seller types in. Shows which source was used, and lets the seller override any figure.
- **Extra answers per store:**
  - **Break-even price** (lowest price that doesn't lose money) and the **price needed to hit the green margin**
  - Optional overhead share (from `allocateOverheads`, as a % of revenue) for "after overheads"
  - Once **Advertising** is in: an expected ad cost % and the break-even ACOS
- **Saving it:** checks can be saved as "candidate products" (no orders, not in the catalog) and later turned into a real product with one click, copying the costs across (backdated `effective_from` set to the date it's created).
- **Where it shows:** its own page under Dashboards (or Manage → Products), with a store-by-store table (one row per store, labelled with its platform).
- **Relationship to Phase 3:** this is the simple version of the **Pre-listing what-if simulator**. That later version swaps the average fee % for exact `fee_rules` (per category, fixed fees, fee caps) and adds sensitivity sliders.

**Product categories (parent / child, added 2026-10-03)**

- Each product can have a **parent category** and a **child category** (e.g. Garden → Power Tools). Optional; a product with no category shows as "Uncategorised".
- **Data:** a `product_categories` table (tenant, name, optional parent) with `master_products.category_id` pointing at the child (or a parent with no children). Two levels only.
- **Setting it:** on the product page, a `category` / `subcategory` pair of columns in Catalog Import, and bulk "set category" on the Products list.
- **Using it:**
  - Filter and group on Margins (category subtotals: sum first, then %), Channel Overview, Trends and Opportunities
  - Margin by category, and refund % by category (once refunds are in)
  - Later: per-category margin colour ranges and overhead reports, and category benchmarking (Phase 3)

**Knowledge base for customer service (added 2026-10-06)**

Answers for customer questions ("why is my margin lower than Amazon says?", "why was this order skipped?"), built from the app's own logic, but explaining *what* the numbers mean, not *how* Margin Hero works them out. The detailed calculation rules are the product's edge and stay private.

- **Two layers:**
  - **Customer-facing help centre** (public, or in-app): what each figure means (Gross / Net profit, margin %, refund rate, overhead share), how to download each channel's report, what each import message means and how to fix it (unmapped SKUs, missing costs, held-back lines), and FAQs. Outcome-level only, e.g. "refunds count in the period they happen and the item is treated as back in stock".
  - **Internal support notes** (private, never published): the full logic per channel and per figure, for whoever answers support (you, staff, or an AI assistant), so answers are consistent and right.
- **What stays private (the "secret sauce"):** per-channel parsing rules (which columns / fee types are used, how order-level fees and discounts are shared across lines), VAT workarounds when a channel doesn't report it, refund unit and lag logic, overhead allocation method details, and the SQL behind the views. Standard definitions customers need to trust the numbers (e.g. margin = net profit ÷ net sales) are fine to publish.
- **Source:** start from `docs/margin-hero-how-to-guide.md` (already customer-friendly) and review it against the list above before publishing, since it currently explains some calculations in detail. CLAUDE.md and the migrations become the internal notes.
- **AI support assistant (later):** if one answers customers, give it only the customer-facing layer, never the internal notes, so it can't be talked into revealing the calculations. It can hand anything deeper to a person.
- **Keep it up to date:** each new feature or channel adds its customer-facing page and internal note in the same change (like the how-to guide rule in CLAUDE.md).

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
  1. ✅ **Overall (first):** a tenant setting for the two cut-offs (e.g. red below 12%, green from 25%), used by every dashboard and the grid. (Done 2026-10-01: `/settings`.)
  2. **Per store (later):** override for a store where margins are naturally different (e.g. TikTok with high fees).
  3. **Per product (future):** override for individual products, e.g. a high-volume commodity line that's healthy at 8%.
  Most specific wins: product → store → overall.
- **Colour thresholds are per-tenant, not hardcoded** — a 10% margin might be fine for a high-volume commodity product, bad for a niche one. Let tenants set their own green/amber/red cutoffs.
- ✅ **Empty cells ("—") are an expansion signal** — a SKU not listed on a channel could later become a soft CTA ("not yet listed here"). (Done 2026-10-02: `/margins` (was `/grid`) shows "Not listed" vs "—" (listed, no sales), and `/opportunities` lists profitable products not yet listed in every store.)
- **Grid needs sort/filter** — by lowest margin, by channel, by category — to stay useful once a tenant has more than a handful of SKUs. (Sort by any store's % or £ done 2026-10-02 on `/margins`; category filter comes with **Product categories** above.)
- **Bundle SKUs need visual distinction** — a bundle has different shipping economics to a single unit; the grid should make clear when a margin figure reflects a bundle sale vs a single sale, or the swing looks like an error.

---

## Phase 2 — v2 (API sync + reimbursements)

- **Read the marketplaces' API data rules first (added 2026-10-06):** Amazon's SP-API has its own Data Protection Policy (security requirements, limits on buyer personal data) that Amazon checks before granting access; other marketplaces have similar terms. It shapes how the sync is built.
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
- **Break-even ACOS per SKU**: moved into Phase 1 **Advertising**
- **Pre-listing what-if simulator** (the full version of Phase 1's **New product margin checker**) — model margin at a hypothetical price/fee/ad-spend combination before committing to a listing, using the `fee_rules` engine already built for pre-sale forecasting in Phase 2
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
