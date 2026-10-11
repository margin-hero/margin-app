import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { loadMarginSummary, type SummaryRow } from './marginSummary'
import { loadAdSpend, tacosPercent, type AdSpendLine } from './adSpend'
import { loadOverheadSetup, allocateOverheads } from './overheads'
import { priorRange, type DashboardFilters, type DateRange } from './dashboardFilters'

// Totals for the drill-down dashboards. Always SUM the pence first (per whatever grouping
// the page needs: whole business, store, product, product × store), THEN work percentages
// out from the sums with metrics(). Never average per-order percentages.

export type Totals = {
  revenuePence: number // net revenue (ex. VAT when the store is VAT registered), net of refunds
  productCostPence: number // landed product cost (Gross profit = revenue − this)
  totalCostPence: number // product + other costs + channel fees + shipping
  feesPence: number // channel fees (0 until the cost-split migration has run: see costSplit)
  shippingPence: number // your shipping cost
  marginPence: number // revenue − total cost (net profit before ads and overheads)
  grossSalesPence: number // what customers paid, inc. VAT and delivery (less refunds)
  saleGrossPence: number // the same, sale rows only (for the average price paid)
  unitsSold: number // sale rows only
  netUnits: number // units sold − units refunded
  orders: number // sale lines
  refundedUnits: number
  adCostPence: number // cost to the business (inc. VAT if not VAT registered)
  adSpendPence: number // ex. VAT, as the channel shows it (for TACOS)
  adSalesPence: number // sales the channel says the ads brought in (for ACOS)
  overheadPence: number // this group's share of the period's overheads (fractional)
}

export const emptyTotals = (): Totals => ({
  revenuePence: 0, productCostPence: 0, totalCostPence: 0, feesPence: 0, shippingPence: 0, marginPence: 0, grossSalesPence: 0, saleGrossPence: 0,
  unitsSold: 0, netUnits: 0, orders: 0, refundedUnits: 0, adCostPence: 0, adSpendPence: 0, adSalesPence: 0, overheadPence: 0,
})

// One period's raw figures. overheadShares lines up with rows (empty when overheads are off).
export type PeriodData = {
  range: DateRange
  rows: SummaryRow[]
  ads: AdSpendLine[]
  overheadShares: number[]
  overheadUnallocatedPence: number // overheads with no sales to carry them
  costSplit: boolean // fees and shipping are known separately (cost-split migration has run)
}

// Sums a period into groups. `row` / `ad` give each summary row's / ad line's group key
// (return null to leave it out).
export function groupTotals(
  period: PeriodData,
  key: { row: (r: SummaryRow) => string | null; ad: (l: AdSpendLine) => string | null }
): Map<string, Totals> {
  const groups = new Map<string, Totals>()
  const get = (k: string) => {
    let t = groups.get(k)
    if (!t) groups.set(k, (t = emptyTotals()))
    return t
  }
  period.rows.forEach((r, i) => {
    const k = key.row(r)
    if (k === null) return
    const t = get(k)
    t.revenuePence += r.revenue_pence
    t.productCostPence += r.product_cost_pence
    t.totalCostPence += r.total_cost_pence
    t.feesPence += r.fees_pence ?? 0
    t.shippingPence += r.shipping_pence ?? 0
    t.marginPence += r.margin_pence
    t.grossSalesPence += r.gross_sales_pence
    t.netUnits += r.effective_qty // refund rows are negative
    t.refundedUnits += r.refunded_units
    if (r.line_type === 'sale') {
      t.saleGrossPence += r.gross_sales_pence
      t.unitsSold += r.effective_qty
      t.orders += r.lines
    }
    t.overheadPence += period.overheadShares[i] || 0
  })
  for (const l of period.ads) {
    const k = key.ad(l)
    if (k === null) continue
    const t = get(k)
    t.adCostPence += l.cost_pence
    t.adSpendPence += l.spend_pence
    t.adSalesPence += l.attributed_sales_pence
  }
  return groups
}

// Everything in the period added together
export function grandTotals(period: PeriodData): Totals {
  const t = groupTotals(period, { row: () => 'all', ad: () => 'all' }).get('all') ?? emptyTotals()
  t.overheadPence += period.overheadUnallocatedPence // still a cost, even with no sales to share it over
  return t
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

export type ProfitOptions = { ads: boolean; overheads: boolean }

// The figures worked out from summed totals. Percentages are null when there's no revenue.
export function metrics(t: Totals, opts: ProfitOptions) {
  const netProfitPence = t.marginPence - (opts.ads ? t.adCostPence : 0) - (opts.overheads ? t.overheadPence : 0)
  const grossProfitPence = t.revenuePence - t.productCostPence
  return {
    netProfitPence,
    netMarginPercent: pct(netProfitPence, t.revenuePence),
    grossProfitPence,
    grossMarginPercent: pct(grossProfitPence, t.revenuePence),
    profitPerUnitPence: t.netUnits > 0 ? Math.round(netProfitPence / t.netUnits) : null,
    acosPercent: t.adSpendPence > 0 && t.adSalesPence > 0 ? pct(t.adSpendPence, t.adSalesPence) : null,
    tacosPercent: t.adSpendPence > 0 ? tacosPercent({ costPence: t.adCostPence, spendPence: t.adSpendPence, attributedSalesPence: 0 }, t.grossSalesPence) : null,
  }
}
export type Metrics = ReturnType<typeof metrics>

// Break-even ACOS: the ad spend (as % of sales, like ACOS) that would take net profit to £0,
// assuming the ad sales make the same margin as the rest. ACOS uses spend ex. VAT; a store
// that isn't VAT registered pays the VAT on top (20% when there's no spend to tell from).
export function breakEvenAcos(t: Totals, opts: ProfitOptions, vatRegistered: boolean): number | null {
  const beforeAds = t.marginPence - (opts.overheads ? t.overheadPence : 0)
  const spendPerCost = t.adCostPence > 0 ? t.adSpendPence / t.adCostPence : vatRegistered ? 1 : 1 / 1.2
  return t.grossSalesPence > 0 ? pct(beforeAds * spendPerCost, t.grossSalesPence) : null
}

// Just the rows and ad lines for one product (or any other test), keeping each row's
// overhead share (worked out across the whole business) lined up with it
export function filterPeriod<P extends PeriodData>(p: P, keep: { row: (r: SummaryRow) => boolean; ad: (l: AdSpendLine) => boolean }): P {
  const rowKeep = p.rows.map(keep.row)
  return {
    ...p,
    rows: p.rows.filter((_, i) => rowKeep[i]),
    ads: p.ads.filter(keep.ad),
    overheadShares: p.overheadShares.length ? p.overheadShares.filter((_, i) => rowKeep[i]) : [],
    overheadUnallocatedPence: 0, // business-wide, not any one product's
  }
}

// Where each £ of revenue went, in the cost stack's order. "other" is whatever's left of the
// total cost (packaging, pick & pack, per-order costs, VAT when not registered...), so the
// parts always add up. Ads / overheads only when they're being taken off.
export function costParts(t: Totals, opts: ProfitOptions) {
  return {
    product: t.productCostPence,
    fees: t.feesPence,
    shipping: t.shippingPence,
    other: t.totalCostPence - t.productCostPence - t.feesPence - t.shippingPence,
    ads: opts.ads ? t.adCostPence : 0,
    overheads: opts.overheads ? t.overheadPence : 0,
  }
}

// Loads one or more date ranges with the same settings. Overheads are shared across ALL
// stores' sales first, then the store filter applies, so one store's share stays the same
// whether you look at it alone or with the others.
export async function loadPeriods(
  ranges: DateRange[],
  f: Pick<DashboardFilters, 'store' | 'overheads'>,
  db: SupabaseClient = supabase
): Promise<{ periods: PeriodData[]; error: string | null }> {
  const [setup, ...loaded] = await Promise.all([
    f.overheads ? loadOverheadSetup(db) : null,
    ...ranges.map((r) => Promise.all([loadMarginSummary(r, db), loadAdSpend(r, db)])),
  ])
  const error = loaded.find(([s]) => s.error)?.[0].error
  if (error) return { periods: [], error: error.message }
  return { periods: ranges.map((range, n) => buildPeriod(range, loaded[n][0].data, loaded[n][1], setup, f.store)), error: null }
}

type OverheadSetup = Awaited<ReturnType<typeof loadOverheadSetup>>

function buildPeriod(range: DateRange, rows: SummaryRow[], ads: AdSpendLine[], setup: OverheadSetup | null, store: string | null): PeriodData {
  const allocation = setup ? allocateOverheads(rows, setup, range.from, range.to) : null
  const keep = rows.map((r) => !store || r.store_id === store)
  return {
    range,
    rows: rows.filter((_, i) => keep[i]),
    ads: ads.filter((l) => !store || l.store_id === store),
    overheadShares: allocation ? allocation.shares.filter((_, i) => keep[i]) : [],
    // Unshared overheads belong to the whole business, so only count them with all stores
    overheadUnallocatedPence: allocation && !store ? allocation.unallocatedPence : 0,
    costSplit: rows.every((r) => r.fees_pence !== null),
  }
}

// One period per calendar month in the span (the first and last may be part months),
// loaded in one go. Each month's overheads are shared across that month's sales only.
export async function loadMonthlyPeriods(
  span: DateRange,
  f: Pick<DashboardFilters, 'store' | 'overheads'>,
  db: SupabaseClient = supabase
): Promise<{ periods: (PeriodData & { month: string })[]; error: string | null }> {
  const [setup, summary, ads] = await Promise.all([
    f.overheads ? loadOverheadSetup(db) : null,
    loadMarginSummary(span, db),
    loadAdSpend(span, db),
  ])
  if (summary.error) return { periods: [], error: summary.error.message }

  const periods: (PeriodData & { month: string })[] = []
  for (let month = span.from.slice(0, 7); month <= span.to.slice(0, 7); ) {
    const [y, m] = month.split('-').map(Number)
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7) // the month after
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const range = { from: month === span.from.slice(0, 7) ? span.from : `${month}-01`, to: monthEnd < span.to ? monthEnd : span.to }
    const rows = summary.data.filter((r) => r.month === month)
    const monthAds = ads.filter((l) => l.spend_date.slice(0, 7) === month)
    periods.push({ month, ...buildPeriod(range, rows, monthAds, setup, f.store) })
    month = next
  }
  return { periods, error: null }
}

// The filters' period plus the one before it (null when comparison is off)
export async function loadDashboardPeriods(
  f: DashboardFilters,
  db: SupabaseClient = supabase
): Promise<{ current: PeriodData | null; previous: PeriodData | null; error: string | null }> {
  const ranges = [{ from: f.from, to: f.to }, ...(f.compare ? [priorRange(f)] : [])]
  const { periods, error } = await loadPeriods(ranges, f, db)
  if (error) return { current: null, previous: null, error }
  return { current: periods[0], previous: periods[1] ?? null, error: null }
}
