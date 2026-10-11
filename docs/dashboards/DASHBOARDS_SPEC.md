# Margin Hero — Dashboards Build Spec

Source of truth for the dashboard redesign. Mock-ups live in `docs/dashboards/mockups/` (`*.dc.html`).
Those files are **design references only** — they were made in a design-canvas tool and won't run as-is
(they depend on a `support.js` runtime). Read them for layout, colours, copy, KPI choices and sample
numbers, then rebuild each page as a normal Next.js App Router page using our existing stack
(Supabase, Tailwind, recharts, `components/Nav.tsx`, `lib/theme.ts`).

---

## 1. Hierarchy (drill-down)

```
Level 0  Profit Overview   /            (or /dashboard)   "Am I making money?"
            │
            ├── Level 1a  Channel Overview   /channel-overview   "Which channel earns its keep?"
            └── Level 1b  SKU × Channel Grid /grid               "Which SKU, on which channel?"  ← the hub
                              │
                              └── Level 2  SKU Detail   /sku-detail?sku=LL-1   "Why is this SKU winning/losing?"

Cross-cutting   Alerts & Actions   /alerts   "What do I fix today?"
```

Every number should be clickable down one level (channel row → grid filtered to that channel; grid cell → SKU detail
with that SKU + channel highlighted; alert → the page that fixes it).

## 2. Global rules (apply to every dashboard)

- **Shared filter bar** in/under the Nav: date range (default last 30 days), comparison period (prior period),
  channel filter. Persist in the URL query string so drill-down links keep the same range.
- **Aggregation:** always SUM pence totals first, then derive % from totals. Never average per-order percentages.
- **Definitions** (existing):
  - Net revenue = revenue ex VAT when VAT-registered (tenant setting); gross when not.
  - Gross profit = revenue − landed product cost only (`product_cost_pence`).
  - Net profit = revenue − everything (`total_cost_pence`: product cost + other costs + fees + shipping; + ads once tracked; + overhead in Phase 3).
  - Margin % denominator = net revenue.
  - Profit per unit = net profit ÷ effective units (respect `units_per_sale`).
- **Amazon FBA vs FBM** are shown as separate channels everywhere.
- **Margin tiers** (one shared helper, e.g. `lib/marginTier.ts`):
  | Tier | Rule | Colour |
  |---|---|---|
  | Loss | < 0% | `#FF4D5E` |
  | Thin | 0–10% | `#FFB020` |
  | OK | 10–18% | `#7A9400` |
  | Strong | ≥ 18% | `#D2FF00` (brand lime) |
  Text on tier fills is `#1B1C19`. Make thresholds tenant-configurable later.
- **Brand:** background `#1B1C19`, cards `#252622`, borders `#363731`, text `#EBEEE0`, muted `#A3A69A`, accent lime `#D2FF00`.
  Page titles use the `display` style from `lib/theme.ts` (Mona Sans Expanded Black, uppercase). Body Mona Sans.
- **Deltas** vs comparison period: ▲/▼ with colour (lime good, red bad). For cost metrics, "up" is bad.
- Mobile: cards stack, wide tables scroll horizontally inside their card, touch targets ≥ 44px.

## 3. Dashboards

### Level 0 — Profit Overview (`mockups/Main.dc.html`)
| Block | Content |
|---|---|
| KPI row (6 cards) | Net profit £, Net margin %, Net revenue £ (+ units), Gross margin %, Profit per unit £, TACOS % (+ ad spend £). Each with delta vs prior. |
| Alerts strip | Count + top 3 alert titles, link to `/alerts`. |
| "Where the money goes" | Horizontal waterfall: Net revenue → COGS → Marketplace fees → Shipping → Pick & pack → Advertising → Net profit. £ and % of revenue. |
| Net profit trend | 12 weekly bars, latest highlighted (recharts). |
| Profit by channel | Bar per channel (net profit £) + tier pill (net margin %). Link to `/channel-overview`. |
| Top 5 / Weakest 5 SKUs | By net profit £ / by net margin %. Rows link to SKU detail. |

### Level 1a — Channel Overview (`mockups/Channels.dc.html`)
Extend the existing `/channel-overview` cards.
- Card per channel: net profit £ (hero), net margin % tier pill, revenue, gross margin %, fees % of revenue, units, profit/unit, TACOS.
- **Cost stack by channel:** 100% stacked bar per channel — product cost, fees, shipping, pick & pack, advertising, net profit.
- Card click → `/grid?channel=<id>`.

### Level 1b — SKU × Channel Grid (`mockups/Grid.dc.html`)
Upgrade existing `/grid` — this is the hub.
- Metric toggle: Net margin % | Gross margin % | Net profit per unit £.
- Rows = master SKUs, columns = channels (FBA/FBM separate), final "All" column (sum-then-derive).
- Cells coloured by tier; "—" where not listed. Legend above.
- Sort by All-column (worst first option), search box, cell click → `/sku-detail?sku=X&channel=Y`.

### Level 2 — SKU Detail (`mockups/SkuDetail.dc.html`)
Extend existing `/sku-detail`.
- Header: SKU + product name, SKU search, "Edit costs" → `/products/[id]`.
- KPI row: Net profit, Net margin (delta), Gross margin, Profit/unit (+ units), Landed cost (+ effective date), Best channel.
- **Per-channel table:** price, units, net sales, gross profit £/%, net profit £/%, profit/unit, break-even ACOS. Totals row.
  - Break-even ACOS = net margin % before ad cost.
- **Unit economics:** waterfall for one unit on a selected channel: price ex VAT → cost price → freight/landed → referral fee → fulfilment fee → ads → net profit.
- **Margin history:** monthly net margin %, with markers where a `cogs_components` or `shipping_rules` row's `effective_from` falls (and fee changes later).

### Alerts & Actions (`mockups/Alerts.dc.html`) — new `/alerts`
- Summary cards: Losing money (count + £/month leaking), Margin dropping, Data gaps, Last import age.
- Alert list: type badge, title, detail, £ impact/month, action button linking to the fix page.
- Rules (toggle each; store per tenant in an `alert_rules` table):
  1. Listing net margin < 0%
  2. Net margin drops ≥ 3 pts vs prior period (same SKU × channel)
  3. ACOS above break-even *(needs ad tracking)*
  4. Fee per unit changed *(needs fee breakdown)*
  5. Orders missing COGS or shipping rule
  6. Channel import older than 7 days
- MVP: compute on page load (a SQL view or server function). Later: scheduled job + push/email (roadmap).

## 4. Data gaps to close (build order matters)

| Needed for | Gap | Suggested approach |
|---|---|---|
| Waterfall, cost stack, unit economics | Fees are one total; need fee **type** split (referral, fulfilment, other) | Add fee breakdown columns / a `order_fees` table populated by importers; view exposes each. |
| TACOS, break-even ACOS, ads in waterfall | No ad spend yet | Ad cost tracking (already next on roadmap). Until then hide/show "—". |
| Deltas | Comparison period queries | One helper that runs the same aggregate for two ranges. |
| Margin history markers | Change events | Read `effective_from` from `cogs_components` + `shipping_rules`. |
| FBA vs FBM | Fulfilment channel per order | Flag on order line / separate platform_listing (decide in importer). |
| Alerts "missing COGS" | Orders whose cost lookup returned null | Expose a flag in `order_margins`. |
| **Security** | **RLS policies + Supabase Auth still deferred** | **Must be done before any real tenant data / go-live.** |

## 5. Suggested build order
1. Shared pieces: filter bar (URL state), `marginTier` helper, KPI card, delta component, aggregate helper (sum-then-derive, two periods).
2. Upgrade `/grid` (hub) with metric toggle, All column, legend, links.
3. Upgrade `/sku-detail` (per-channel table + KPIs + history; unit economics with what fees we have).
4. Upgrade `/channel-overview` (new card fields; cost stack once fee split exists).
5. New Profit Overview home.
6. `/alerts` (rules 1, 2, 5, 6 first).
7. After ad tracking + fee split: TACOS, break-even ACOS, full waterfalls, rules 3 & 4.

Sample numbers in the mock-ups are made up — always use real data from the views.
