import { supabase } from './supabase'
import { fetchAll } from './fetchAll'

// Overheads are turned into a cost per day, then shared across sales.
// Amounts stay as fractional pence through the maths and are only rounded for display,
// so totals add up (sum first, round last).

export type Overhead = {
  id: string
  store_id: string | null
  name: string
  category: string
  amount_pence: number
  vat_rate: number
  kind: 'recurring' | 'one_off'
  frequency: 'weekly' | 'four_weekly' | 'monthly' | 'quarterly' | 'yearly' | null
  spread_months: number | null
  start_date: string
  end_date: string | null
}

export type AllocationBasis = 'revenue' | 'units' | 'orders'

export const CATEGORIES: { code: string; label: string }[] = [
  { code: 'wages', label: 'Wages & staff' },
  { code: 'rent', label: 'Rent / mortgage' },
  { code: 'business_rates', label: 'Business rates' },
  { code: 'utilities', label: 'Utilities' },
  { code: 'subscriptions', label: 'Software & subscriptions' },
  { code: 'registrations', label: 'Registrations & compliance' },
  { code: 'equipment', label: 'Equipment & machinery' },
  { code: 'professional_fees', label: 'Accountant & professional fees' },
  { code: 'insurance', label: 'Insurance' },
  { code: 'other', label: 'Other' },
]

export const FREQUENCIES: { code: NonNullable<Overhead['frequency']>; label: string }[] = [
  { code: 'weekly', label: 'Weekly' },
  { code: 'four_weekly', label: 'Every 4 weeks' },
  { code: 'monthly', label: 'Monthly' },
  { code: 'quarterly', label: 'Quarterly' },
  { code: 'yearly', label: 'Yearly' },
]

export const BASES: { code: AllocationBasis; label: string; explain: string }[] = [
  { code: 'revenue', label: 'Share of revenue', explain: 'Each sale carries overhead in proportion to its revenue. Every product\'s margin drops by the same percentage points.' },
  { code: 'units', label: 'Share of units sold', explain: 'Each unit shipped carries the same overhead. Hits cheap, high-volume products harder.' },
  { code: 'orders', label: 'Share of orders', explain: 'Each order line carries the same overhead, whatever its size or value.' },
]

// ---- Dates (all 'YYYY-MM-DD', treated as UTC days) ----

const DAY = 86_400_000
const toDays = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY)
const fromDays = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)

export function addDays(d: string, n: number) {
  return fromDays(toDays(d) + n)
}

// e.g. 31 Jan + 1 month = 28/29 Feb (clamped to the month's last day, not rolled into March)
function addMonths(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const daysInMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, daysInMonth))
  return target.toISOString().slice(0, 10)
}

// ---- Per-overhead maths ----

// The last day the overhead applies (null = ongoing)
export function lastDay(o: Overhead): string | null {
  if (o.kind === 'one_off') return addDays(addMonths(o.start_date, o.spread_months || 1), -1)
  return o.end_date
}

// Cost per day while active, in pence, ex. VAT if `netOfVat`
export function perDayPence(o: Overhead, netOfVat: boolean): number {
  const amount = netOfVat ? o.amount_pence / (1 + o.vat_rate) : o.amount_pence
  if (o.kind === 'one_off') return amount / (toDays(lastDay(o)!) - toDays(o.start_date) + 1)
  switch (o.frequency) {
    case 'weekly': return amount / 7
    case 'four_weekly': return amount / 28
    case 'monthly': return (amount * 12) / 365
    case 'quarterly': return (amount * 4) / 365
    case 'yearly': return amount / 365
    default: return 0
  }
}

// How much of this overhead falls in [from, to] (inclusive)
export function overheadInRange(o: Overhead, from: string, to: string, netOfVat: boolean): number {
  const start = Math.max(toDays(o.start_date), toDays(from))
  const last = lastDay(o)
  const end = Math.min(last ? toDays(last) : Infinity, toDays(to))
  if (end < start) return 0
  return perDayPence(o, netOfVat) * (end - start + 1)
}

export function describeSchedule(o: Overhead): string {
  const pounds = `£${(o.amount_pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (o.kind === 'one_off') {
    return `${pounds} one-off on ${o.start_date}, spread over ${o.spread_months} month${o.spread_months === 1 ? '' : 's'}`
  }
  const freq = FREQUENCIES.find((f) => f.code === o.frequency)?.label.toLowerCase()
  return `${pounds} ${freq} from ${o.start_date}${o.end_date ? ` to ${o.end_date}` : ''}`
}

// ---- Loading ----

export async function loadOverheadSetup() {
  const [{ data: tenant }, overheads, { data: stores }] = await Promise.all([
    supabase.from('tenants').select('id, vat_registered, overhead_allocation_basis').eq('name', 'Test Store').single(),
    fetchAll((from, to) => supabase.from('overheads').select('*').order('start_date').order('id').range(from, to)),
    supabase.from('stores').select('id, vat_registered'),
  ])
  return {
    tenantId: (tenant?.id as string) || null,
    // Whole-business overheads follow the business's VAT status; store overheads follow the store's
    businessVatRegistered: !!tenant?.vat_registered,
    basis: ((tenant?.overhead_allocation_basis as AllocationBasis) || 'revenue') as AllocationBasis,
    overheads: overheads.data as Overhead[],
    storeVat: new Map<string, boolean>((stores || []).map((s) => [s.id, s.vat_registered])),
  }
}

// ---- Allocation ----

export type SaleLine = { store_id: string; revenue_pence: number; effective_qty: number }

// Shares every overhead falling in [from, to] across the sale lines.
// Whole-business overheads go across all lines; store overheads across that store's lines.
// Returns each line's share (same order as `lines`), the total overhead in the period,
// and any part that couldn't be shared because there were no sales to carry it.
export function allocateOverheads(
  lines: SaleLine[],
  setup: Awaited<ReturnType<typeof loadOverheadSetup>>,
  from: string,
  to: string
): { shares: number[]; totalPence: number; unallocatedPence: number } {
  const weight = (l: SaleLine) =>
    setup.basis === 'units' ? l.effective_qty : setup.basis === 'orders' ? 1 : Math.max(0, Number(l.revenue_pence) || 0)

  // Pools: '' = whole business, otherwise a store id
  const pools = new Map<string, number>()
  for (const o of setup.overheads) {
    const net = o.store_id ? !!setup.storeVat.get(o.store_id) : setup.businessVatRegistered
    const amount = overheadInRange(o, from, to, net)
    if (amount > 0) pools.set(o.store_id || '', (pools.get(o.store_id || '') || 0) + amount)
  }

  const shares = lines.map(() => 0)
  let total = 0
  let unallocated = 0
  for (const [poolStore, amount] of pools) {
    total += amount
    const idx = lines.map((l, i) => i).filter((i) => !poolStore || lines[i].store_id === poolStore)
    const totalWeight = idx.reduce((s, i) => s + weight(lines[i]), 0)
    if (totalWeight <= 0) {
      unallocated += amount
      continue
    }
    for (const i of idx) shares[i] += (amount * weight(lines[i])) / totalWeight
  }
  return { shares, totalPence: total, unallocatedPence: unallocated }
}
