import type { CSSProperties, ReactNode } from 'react'
import { costParts, metrics, type Totals, type ProfitOptions } from '@/lib/dashboardTotals'
import { pounds, wholePounds } from '@/lib/format'
import { bg, muted, dim, red, chartProfit, cardTitle } from '@/lib/theme'

// "Where the money goes": net revenue, each cost taken off in turn, then net profit.
// perUnit = divide everything by this many units (one unit's economics, in £ and pence).
export default function MoneyBridge({ id, totals, opts, costSplit, perUnit, title, style, children }: {
  id?: string // anchor, e.g. for links that scroll to it
  totals: Totals
  opts: ProfitOptions
  costSplit: boolean // fees and shipping known separately (cost-split migration has run)
  perUnit?: number
  title: string
  style: CSSProperties
  children?: ReactNode // e.g. a subtitle or picker under the title
}) {
  const per = (v: number) => (perUnit ? v / perUnit : v)
  const money = (v: number) => (perUnit ? pounds(Math.round(v)) : wholePounds(v))
  const revenue = per(totals.revenuePence)
  const netProfit = per(metrics(totals, opts).netProfitPence)
  const parts = costParts(totals, opts)
  const costs = [
    { label: 'Product cost', value: per(parts.product), tip: 'Landed product cost' },
    ...(costSplit ? [
      { label: 'Channel fees', value: per(parts.fees), tip: 'Commission, fulfilment and other channel fees' },
      { label: 'Shipping', value: per(parts.shipping), tip: 'Your shipping cost' },
      { label: 'Other costs', value: per(parts.other), tip: 'Packaging, pick & pack, per-order costs and anything else' },
    ] : [
      { label: 'Fees, shipping & other', value: per(parts.fees + parts.shipping + parts.other), tip: 'Channel fees, shipping and other per-unit / per-order costs' },
    ]),
    ...(opts.ads ? [{ label: 'Advertising', value: per(parts.ads), tip: 'Ad spend' }] : []),
    ...(opts.overheads ? [{ label: 'Overheads', value: per(parts.overheads), tip: 'Share of overheads' }] : []),
  ]
  // The scale runs from the lowest point (below zero on a loss) to the highest
  let running = revenue
  const steps = costs.map((c) => {
    const start = running
    running -= c.value
    return { ...c, from: Math.min(start, running), to: Math.max(start, running) }
  })
  const points = [0, revenue, netProfit, ...steps.flatMap((s) => [s.from, s.to])]
  const lo = Math.min(...points)
  const hi = Math.max(...points)
  const x = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0)
  const share = (v: number) => (revenue > 0 ? `${Math.round((v / revenue) * 1000) / 10}%` : '')

  const row = (label: string, value: string, pct: string, from: number, to: number, colour: string, tip: string) => (
    <div key={label} title={`${tip}: ${value}${pct ? ` (${pct} of revenue)` : ''}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 150px) minmax(0, 1fr) auto', alignItems: 'center', gap: '12px' }}>
      <div style={{ fontSize: '14px' }}>{label}</div>
      <div style={{ height: '22px', background: bg, borderRadius: '4px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${x(from)}%`, width: `${Math.max(x(to) - x(from), 0.4)}%`, background: colour, borderRadius: '4px' }} />
      </div>
      <div style={{ fontSize: '14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {value} <span style={{ color: muted, display: 'inline-block', minWidth: '48px' }}>{pct}</span>
      </div>
    </div>
  )

  return (
    <section id={id} aria-label={title} style={{ scrollMarginTop: '16px', ...style }}>
      <h2 style={cardTitle}>{title}</h2>
      {children}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {row(perUnit ? 'Net price' : 'Net revenue', money(revenue), revenue > 0 ? '100%' : '', Math.min(0, revenue), Math.max(0, revenue), dim, perUnit ? 'Net revenue per unit' : 'Net revenue')}
        {steps.map((s) => row(s.label, money(-s.value), share(s.value), s.from, s.to, red, s.tip))}
        {row('Net profit', money(netProfit), share(netProfit), Math.min(0, netProfit), Math.max(0, netProfit), netProfit < 0 ? red : chartProfit, 'Net profit')}
      </div>
      {!costSplit && (
        <p style={{ fontSize: '12px', color: muted, margin: '14px 0 0' }}>
          Fees, shipping and other costs show as one figure until the database update 20261011120000_margin_summary_cost_split.sql has been run.
        </p>
      )}
    </section>
  )
}
