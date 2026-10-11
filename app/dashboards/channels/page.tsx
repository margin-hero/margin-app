import { connection } from 'next/server'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { createServerSupabase } from '@/lib/supabaseServer'
import { loadMarginRanges } from '@/lib/marginRanges'
import { loadStores, storeLabel } from '@/lib/stores'
import { parseFilters, priorRange, profitBasis, ukRange, dashHref } from '@/lib/dashboardFilters'
import { loadDashboardPeriods, grandTotals, groupTotals, metrics, costParts, type Totals, type ProfitOptions } from '@/lib/dashboardTotals'
import { pounds, wholePounds, ukDate } from '@/lib/format'
import { lime, red, muted, text, border, bg, panel, chartProfit, chartCosts, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, display } from '@/lib/theme'
import FilterBar from '@/components/dashboards/FilterBar'
import Delta from '@/components/dashboards/Delta'
import MarginPill from '@/components/dashboards/MarginPill'

const PATH = '/dashboards/channels'

// Level 2 of the drill-down dashboards: "Which channel earns its keep?"
// One card per store (Amazon FBA and FBM are separate stores), then where each £ went.
export default async function ChannelsPage({ searchParams }: PageProps<'/dashboards/channels'>) {
  // Render on every visit so the page shows live data, not a snapshot from build time
  await connection()
  const f = parseFilters(await searchParams)
  const opts = { ads: f.ads, overheads: f.overheads }

  const db = await createServerSupabase()
  const [ranges, stores, { current, previous, error }] = await Promise.all([loadMarginRanges(db), loadStores(db), loadDashboardPeriods(f, db)])
  if (error || !current) return <div style={{ ...pageStyle, color: red }}>Error: {error}</div>

  const byStore = (p: typeof current) => groupTotals(p, { row: (r) => r.store_id, ad: (l) => l.store_id })
  const now = byStore(current)
  const before = previous ? byStore(previous) : null
  const name = (id: string) => storeLabel(stores.find((s) => s.id === id)) || '?'

  // Biggest net profit first
  const channels = [...now]
    .map(([id, t]) => ({ id, name: name(id), totals: t, m: metrics(t, opts), prior: before?.get(id) }))
    .sort((a, b) => b.m.netProfitPence - a.m.netProfitPence)
  const prior = priorRange(f)

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Level 2 · Which channel earns its keep?</p>
      <h1 style={pageTitle}>Channels</h1>
      <p style={pageIntro}>
        Every store from {ukRange(f)}: net profit {profitBasis(f)}, net of refunds.
        {f.compare && <> Changes are vs {ukDate(prior.from)} to {ukDate(prior.to)}.</>}
      </p>

      <FilterBar key={`${f.from}|${f.to}`} path={PATH} filters={f} stores={stores.map((s) => ({ id: s.id, label: storeLabel(s) }))} />

      {channels.length === 0 ? (
        <div style={{ ...cardStyle, color: muted }}>No sales or ad spend from {ukDate(f.from)} to {ukDate(f.to)}. Try a longer date range.</div>
      ) : (
        <>
          <section aria-label="Channel cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 290px), 1fr))', gap: '14px', marginTop: '24px' }}>
            {channels.map((c) => <ChannelCard key={c.id} {...c} href={dashHref('/dashboards/grid', f, { store: c.id })} opts={opts} compare={f.compare} ranges={ranges} />)}
          </section>
          <CostStack
            rows={[
              ...channels.map((c) => ({ id: c.id, name: c.name, totals: c.totals })),
              ...(channels.length > 1 ? [{ id: 'all', name: 'All channels', totals: grandTotals(current) }] : []),
            ]}
            opts={opts}
            costSplit={current.costSplit}
          />
        </>
      )}
    </div>
  )
}

function ChannelCard({ name, href, totals, m, prior, opts, compare, ranges }: {
  name: string
  href: string // this store's products in the SKU × Channel grid
  totals: Totals
  m: ReturnType<typeof metrics>
  prior: Totals | undefined
  opts: ProfitOptions
  compare: boolean
  ranges: Awaited<ReturnType<typeof loadMarginRanges>>
}) {
  const priorM = prior ? metrics(prior, opts) : null
  const feesShare = totals.revenuePence > 0 ? Math.round((totals.feesPence / totals.revenuePence) * 1000) / 10 : null
  const stat = (label: string, value: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: muted }}>{label}</div>
      <div style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
  return (
    <Link href={href} title={`${name}: see every product in this store`} style={{ background: panel, border: `1px solid ${border}`, borderRadius: '16px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0, color: text, textDecoration: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={name}>{name}</h2>
        <MarginPill value={m.netMarginPercent} ranges={ranges} suffix=" net" />
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <div style={{ ...display, fontSize: '28px', textTransform: 'none', color: m.netProfitPence < 0 ? red : text }}>{wholePounds(m.netProfitPence)}</div>
          <div style={{ fontSize: '13px', color: muted }}>net profit</div>
        </div>
        {compare && <div style={{ fontSize: '13px', marginTop: '2px' }}><Delta current={m.netProfitPence} previous={priorM?.netProfitPence ?? null} kind="change" /></div>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px 8px', fontSize: '13px' }}>
        {stat('Net revenue', wholePounds(totals.revenuePence))}
        {stat('Gross margin', m.grossMarginPercent === null ? '—' : `${m.grossMarginPercent}%`)}
        {stat('Fees', feesShare === null ? '—' : `${feesShare}%`)}
        {stat('Units sold', totals.unitsSold.toLocaleString('en-GB'))}
        {stat('Profit / unit', m.profitPerUnitPence === null ? '—' : pounds(m.profitPerUnitPence))}
        {stat('TACOS', m.tacosPercent === null ? '—' : `${m.tacosPercent}%`)}
      </div>
      <div style={{ fontSize: '13px', fontWeight: 700, color: lime }}>Products in this store →</div>
    </Link>
  )
}

// Each channel's net revenue split into where it went, as one 100% bar per channel
const SEGMENTS = [
  { key: 'profit', label: 'Net profit', colour: chartProfit },
  { key: 'product', label: 'Product cost', colour: chartCosts.product },
  { key: 'fees', label: 'Channel fees', colour: chartCosts.fees },
  { key: 'shipping', label: 'Shipping', colour: chartCosts.shipping },
  { key: 'other', label: 'Other costs', colour: chartCosts.other },
  { key: 'ads', label: 'Advertising', colour: chartCosts.ads },
  { key: 'overheads', label: 'Overheads', colour: chartCosts.overheads },
] as const

function CostStack({ rows, opts, costSplit }: { rows: { id: string; name: string; totals: Totals }[]; opts: ProfitOptions; costSplit: boolean }) {
  // Before the cost-split migration, fees and shipping are inside "other"
  const shown = SEGMENTS.filter((s) =>
    (s.key !== 'fees' && s.key !== 'shipping' || costSplit) && (s.key !== 'ads' || opts.ads) && (s.key !== 'overheads' || opts.overheads))
  const label = (key: string) => (key === 'other' && !costSplit ? 'Fees, shipping & other' : SEGMENTS.find((s) => s.key === key)!.label)

  const data = rows.map((r) => {
    const parts = costParts(r.totals, opts)
    const net = metrics(r.totals, opts).netProfitPence
    const values: Record<string, number> = { ...parts, profit: net }
    // The bar is the revenue; on a loss the costs are more than the revenue, so the bar is
    // the costs and a marker shows where the revenue ran out
    const drawn = shown.map((s) => ({ ...s, value: Math.max(0, values[s.key]) }))
    const scale = Math.max(1, drawn.reduce((sum, s) => sum + s.value, 0))
    return { ...r, values, drawn, scale, net, revenue: r.totals.revenuePence }
  })
  const pct = (v: number, revenue: number) => (revenue > 0 ? `${Math.round((v / revenue) * 1000) / 10}%` : '—')

  const legendSwatch = (colour: string): CSSProperties => ({ width: '12px', height: '12px', borderRadius: '3px', background: colour, display: 'inline-block' })

  return (
    <section aria-label="Cost stack by channel" style={cardStyle}>
      <h2 style={cardTitle}>Where each £1 of revenue goes</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', fontSize: '13px', marginBottom: '16px' }}>
        {shown.map((s) => <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={legendSwatch(s.colour)} />{label(s.key)}</span>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {data.map((r) => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 170px) minmax(0, 1fr)', alignItems: 'center', gap: '12px', ...(r.id === 'all' ? { borderTop: `1px solid ${border}`, paddingTop: '12px' } : {}) }}>
            <div style={{ fontSize: '14px', fontWeight: r.id === 'all' ? 800 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</div>
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', gap: '2px', height: '28px', borderRadius: '4px', overflow: 'hidden', background: bg }}>
                {r.drawn.filter((s) => s.value > 0).map((s) => {
                  const share = (s.value / r.scale) * 100
                  return (
                    <div
                      key={s.key}
                      title={`${r.name} · ${label(s.key)}: ${wholePounds(s.value)} (${pct(s.value, r.revenue)} of revenue)`}
                      style={{ flex: `${s.value} 1 0`, minWidth: 0, background: s.colour, color: bg, fontSize: '11px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}
                    >
                      {share >= 9 ? pct(s.value, r.revenue) : ''}
                    </div>
                  )
                })}
              </div>
              {r.net < 0 && r.revenue > 0 && (
                <div title={`Revenue runs out here: costs are ${pct(r.scale, r.revenue)} of revenue`} style={{ position: 'absolute', top: '-4px', bottom: '-4px', left: `${(r.revenue / r.scale) * 100}%`, borderLeft: `2px solid ${text}` }} />
              )}
            </div>
          </div>
        ))}
      </div>
      {data.some((r) => r.net < 0) && (
        <p style={{ fontSize: '12px', color: muted, margin: '12px 0 0' }}>On a loss, costs are more than the revenue: the white line marks where the revenue ran out.</p>
      )}
      {!costSplit && (
        <p style={{ fontSize: '12px', color: muted, margin: '12px 0 0' }}>Fees and shipping split out once the database update 20261011120000_margin_summary_cost_split.sql has been run.</p>
      )}

      <details style={{ marginTop: '16px' }}>
        <summary style={{ cursor: 'pointer', fontSize: '13px', color: muted, minHeight: '24px' }}>Show as a table</summary>
        <div style={{ overflowX: 'auto', marginTop: '10px' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '640px', fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              <tr>
                <th style={thStyle}>Channel</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Net revenue</th>
                {shown.map((s) => <th key={s.key} style={{ ...thStyle, textAlign: 'right' }}>{label(s.key)}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, fontWeight: r.id === 'all' ? 800 : 400 }}>{r.name}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{wholePounds(r.revenue)}</td>
                  {shown.map((s) => (
                    <td key={s.key} style={{ ...tdStyle, textAlign: 'right' }}>
                      {wholePounds(r.values[s.key])} <span style={{ color: muted, fontSize: '12px' }}>{pct(r.values[s.key], r.revenue)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
