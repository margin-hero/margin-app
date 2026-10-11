import { ukDate } from './format'

// The filters shared by the new drill-down dashboards (/dashboards/...), kept in the URL so
// every link down a level carries the same date range, channel and toggles:
//   ?from=2026-09-01&to=2026-09-30  date range (default: last 30 days)
//   &compare=0                      switch off the comparison with the period before
//   &store=<store id>               one store only (default: all)
//   &ads=0                          leave ad spend out of net profit (default: taken off)
//   &overheads=1                    take each sale's share of overheads off too
// Only settings that differ from the defaults go in the URL.

export type DashboardFilters = {
  from: string // YYYY-MM-DD
  to: string
  compare: boolean
  store: string | null
  ads: boolean
  overheads: boolean
}

export type DateRange = { from: string; to: string }

// Dates are whole UTC days, like the rest of the app
const DAY = 86_400_000
const toDays = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY)
const fromDays = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
export const shiftDays = (d: string, n: number) => fromDays(toDays(d) + n)
export const todayIso = () => new Date().toISOString().slice(0, 10)
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

export const DEFAULT_DAYS = 30

export function defaultFilters(): DashboardFilters {
  const to = todayIso()
  return { from: shiftDays(to, -(DEFAULT_DAYS - 1)), to, compare: true, store: null, ads: true, overheads: false }
}

type Params = Record<string, string | string[] | undefined>

export function parseFilters(params: Params): DashboardFilters {
  const get = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '')
  const f = defaultFilters()
  if (isDate(get('from')) && isDate(get('to')) && get('from') <= get('to')) {
    f.from = get('from')
    f.to = get('to')
  }
  f.compare = get('compare') !== '0'
  f.store = get('store') || null
  f.ads = get('ads') !== '0'
  f.overheads = get('overheads') === '1'
  return f
}

// Number of days in the range, counting both ends
export const rangeDays = (r: DateRange) => toDays(r.to) - toDays(r.from) + 1

// The same number of days straight before the range, e.g. 1–30 Sep → 2–31 Aug
export function priorRange(r: DateRange): DateRange {
  const to = shiftDays(r.from, -1)
  return { from: shiftDays(to, -(rangeDays(r) - 1)), to }
}

// The query string for these filters (non-defaults only), plus any page-specific extras
export function filterQuery(f: DashboardFilters, extra: Record<string, string> = {}): string {
  const d = defaultFilters()
  const q: Record<string, string> = {}
  if (f.from !== d.from || f.to !== d.to) {
    q.from = f.from
    q.to = f.to
  }
  if (!f.compare) q.compare = '0'
  if (f.store) q.store = f.store
  if (!f.ads) q.ads = '0'
  if (f.overheads) q.overheads = '1'
  for (const [k, v] of Object.entries(extra)) if (v) q[k] = v
  const qs = new URLSearchParams(q).toString()
  return qs ? `?${qs}` : ''
}

// A link to a dashboard page with these filters, optionally changed, e.g.
// dashHref('/dashboards/grid', f, { store: id }) to drill down into one store
export function dashHref(path: string, f: DashboardFilters, changes: Partial<DashboardFilters> = {}, extra: Record<string, string> = {}): string {
  return path + filterQuery({ ...f, ...changes }, extra)
}

// "01-09-2026 to 30-09-2026"
export const ukRange = (r: DateRange) => `${ukDate(r.from)} to ${ukDate(r.to)}`

// What net profit includes, for subtitles: "after ads and overheads"
export function profitBasis(f: DashboardFilters): string {
  const parts = [f.ads && 'ads', f.overheads && 'overheads'].filter(Boolean)
  return parts.length ? `after ${parts.join(' and ')}` : 'before ads and overheads'
}
