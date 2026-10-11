import { connection } from 'next/server'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { createServerSupabase } from '@/lib/supabaseServer'
import { loadMarginRanges } from '@/lib/marginRanges'
import { loadStores, storeLabel } from '@/lib/stores'
import { parseFilters, priorRange, profitBasis, todayIso, dashHref } from '@/lib/dashboardFilters'
import { loadDashboardPeriods, loadMonthlyPeriods, grandTotals, groupTotals, metrics, type Metrics, type Totals } from '@/lib/dashboardTotals'
import { pounds, wholePounds, ukDate } from '@/lib/format'
import { lime, red, muted, dim, text, border, bg, chartProfit, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle } from '@/lib/theme'
import FilterBar from '@/components/dashboards/FilterBar'
import KpiCard from '@/components/dashboards/KpiCard'
import Delta from '@/components/dashboards/Delta'
import MarginPill from '@/components/dashboards/MarginPill'
import MoneyBridge from '@/components/dashboards/MoneyBridge'
import { loadAlerts } from '@/lib/alerts'

const PATH = '/dashboards/overview'

// Level 1 of the drill-down dashboards: "Am I making money?"
// Every figure is summed in pence first, then percentages are worked out from the totals.
export default async function ProfitOverviewPage({ searchParams }: PageProps<'/dashboards/overview'>) {
  // Render on every visit so the page shows live data, not a snapshot from build time
  await connection()
  const f = parseFilters(await searchParams)
  const opts = { ads: f.ads, overheads: f.overheads }

  // The trend always shows the last 12 months up to today (this month so far), whatever the date range
  const today = todayIso()
  const trendFrom = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 12, 1)).toISOString().slice(0, 10)

  const db = await createServerSupabase()
  const [ranges, stores, { current, previous, error }, trend] = await Promise.all([
    loadMarginRanges(db),
    loadStores(db),
    loadDashboardPeriods(f, db),
    loadMonthlyPeriods({ from: trendFrom, to: today }, f, db),
  ])
  if (error || !current) return <div style={{ ...pageStyle, color: red }}>Error: {error}</div>

  const now = grandTotals(current)
  const nowM = metrics(now, opts)
  const before = previous ? grandTotals(previous) : null
  const beforeM = before ? metrics(before, opts) : null
  const was = <K extends keyof Metrics>(k: K) => (beforeM ? beforeM[k] : null)
  const prior = priorRange(f)

  // Per store and per product, for the lower sections
  const byStore = groupTotals(current, { row: (r) => r.store_id, ad: (l) => l.store_id })
  const byProduct = groupTotals(current, { row: (r) => r.master_product_id, ad: (l) => l.master_product_id })
  const productNames = new Map<string, string>()
  for (const r of current.rows) productNames.set(r.master_product_id, r.product_name)
  for (const l of current.ads) if (!productNames.has(l.master_product_id)) productNames.set(l.master_product_id, l.product_name)

  const hasData = current.rows.length > 0 || current.ads.length > 0
  // Reuses this page's figures when they include the period before
  const alertResult = await loadAlerts(f, db, previous ? { current, previous } : undefined)
  const alerts = 'error' in alertResult ? [] : alertResult.alerts

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Level 1 · Am I making money?</p>
      <h1 style={pageTitle}>Profit overview</h1>
      <p style={pageIntro}>
        Net profit = net revenue minus product cost, channel fees, shipping and other costs
        {f.ads ? ', and ad spend' : ''}{f.overheads ? ', and a share of overheads' : ''}. Net of refunds.
        {f.compare && <> Compared with {ukDate(prior.from)} to {ukDate(prior.to)}.</>}
      </p>

      <FilterBar key={`${f.from}|${f.to}`} path={PATH} filters={f} stores={stores.map((s) => ({ id: s.id, label: storeLabel(s) }))} />

      {!hasData ? (
        <div style={{ ...cardStyle, color: muted }}>No sales or ad spend from {ukDate(f.from)} to {ukDate(f.to)}. Try a longer date range.</div>
      ) : (
        <>
          <section aria-label="Headline figures" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginTop: '24px' }}>
            <KpiCard label="Net profit" value={wholePounds(nowM.netProfitPence)} valueColor={nowM.netProfitPence < 0 ? red : text}>
              {f.compare && <Delta current={nowM.netProfitPence} previous={was('netProfitPence')} kind="change" />}
            </KpiCard>
            <KpiCard label="Net margin" value={nowM.netMarginPercent === null ? '—' : `${nowM.netMarginPercent}%`}>
              {f.compare && <Delta current={nowM.netMarginPercent} previous={was('netMarginPercent')} kind="points" />}
            </KpiCard>
            <KpiCard label="Net revenue" value={wholePounds(now.revenuePence)}>
              {f.compare && <Delta current={now.revenuePence} previous={before?.revenuePence ?? null} kind="change" />}
              <span style={{ color: muted }}>{now.unitsSold.toLocaleString('en-GB')} units sold</span>
            </KpiCard>
            <KpiCard label="Gross margin" value={nowM.grossMarginPercent === null ? '—' : `${nowM.grossMarginPercent}%`}>
              {f.compare && <Delta current={nowM.grossMarginPercent} previous={was('grossMarginPercent')} kind="points" />}
              <span style={{ color: muted }}>after product cost only</span>
            </KpiCard>
            <KpiCard label="Profit per unit" value={nowM.profitPerUnitPence === null ? '—' : pounds(nowM.profitPerUnitPence)}>
              {f.compare && <Delta current={nowM.profitPerUnitPence} previous={was('profitPerUnitPence')} kind="money" />}
            </KpiCard>
            <KpiCard label="TACOS" value={nowM.tacosPercent === null ? '—' : `${nowM.tacosPercent}%`}>
              {f.compare && nowM.tacosPercent !== null && <Delta current={nowM.tacosPercent} previous={was('tacosPercent')} kind="points" goodWhen="down" />}
              <span style={{ color: muted }}>{now.adSpendPence > 0 ? `Ad spend ${wholePounds(now.adSpendPence)} ex. VAT` : 'No ad spend imported'}</span>
            </KpiCard>
          </section>

          <section aria-label="Alerts" style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px', padding: '14px 18px', ...(alerts.length ? { background: 'rgba(255,76,76,0.08)', borderColor: red } : {}) }}>
            <div style={{ fontWeight: 800, color: alerts.length ? red : muted }}>
              {alerts.length ? `${alerts.length} alert${alerts.length === 1 ? '' : 's'} need${alerts.length === 1 ? 's' : ''} attention` : 'No alerts for this period'}
            </div>
            <div style={{ flex: '1 1 380px', display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: '14px', minWidth: 0 }}>
              {alerts.slice(0, 3).map((a, i) => <Link key={i} href={a.href} style={{ color: text, textDecoration: 'none' }}>{a.title}</Link>)}
            </div>
            <Link href={dashHref('/dashboards/alerts', f)} style={{ color: lime, fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>{alerts.length ? 'Review alerts →' : 'Alerts →'}</Link>
          </section>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'stretch' }}>
            <MoneyBridge title="Where the money goes" totals={now} opts={opts} costSplit={current.costSplit} style={flexCard} />
            <ProfitTrend months={trend.periods.map((p) => ({ month: p.month, partial: p.month === today.slice(0, 7), profit: metrics(grandTotals(p), opts).netProfitPence }))} basis={profitBasis(f)} error={trend.error} />
          </div>

          <ProfitByChannel
            rows={[...byStore].map(([id, t]) => ({ name: storeLabel(stores.find((s) => s.id === id)) || id, href: dashHref('/dashboards/grid', f, { store: id }), ...metrics(t, opts) }))}
            ranges={ranges}
            moreHref={dashHref('/dashboards/channels', f)}
          />

          <ProductLists byProduct={byProduct} names={productNames} opts={opts} ranges={ranges} db={db} f={f} />
        </>
      )}
    </div>
  )
}

const flexCard: CSSProperties = { ...cardStyle, flex: '1 1 460px', minWidth: 0 }

// Net profit per calendar month, last 12 months, this month highlighted
function ProfitTrend({ months, basis, error }: { months: { month: string; partial: boolean; profit: number }[]; basis: string; error: string | null }) {
  const CHART = 200
  const maxUp = Math.max(0, ...months.map((m) => m.profit))
  const maxDown = Math.max(0, ...months.map((m) => -m.profit))
  const scale = maxUp + maxDown || 1
  const zeroFromTop = (maxUp / scale) * CHART // where the £0 line sits
  const label = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
  const latest = months[months.length - 1]

  return (
    <section aria-label="Net profit by month" style={flexCard}>
      <h2 style={cardTitle}>Net profit · last 12 months</h2>
      {error ? <p style={{ color: red }}>Error: {error}</p> : (
        <>
          <div style={{ fontSize: '13px', color: muted, margin: '-8px 0 14px' }}>
            {label(latest.month)}{latest.partial ? ' so far' : ''}: <span style={{ color: text, fontWeight: 700 }}>{wholePounds(latest.profit)}</span> · {basis}
          </div>
          <div role="img" aria-label={`Monthly net profit: ${months.map((m) => `${label(m.month)} ${wholePounds(m.profit)}`).join(', ')}`} style={{ position: 'relative', height: `${CHART}px`, display: 'flex', gap: '6px' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: `${zeroFromTop}px`, borderTop: `1px solid ${border}` }} />
            {months.map((m, i) => {
              const h = (Math.abs(m.profit) / scale) * CHART
              const last = i === months.length - 1
              return (
                <div key={m.month} title={`${label(m.month)}${m.partial ? ' (so far)' : ''}: ${wholePounds(m.profit)}`} style={{ flex: 1, position: 'relative', height: '100%' }}>
                  <div style={{
                    position: 'absolute', left: 0, right: 0,
                    top: m.profit >= 0 ? `${zeroFromTop - h}px` : `${zeroFromTop}px`,
                    height: `${Math.max(h, m.profit === 0 ? 0 : 2)}px`,
                    background: last ? chartProfit : dim,
                    borderRadius: m.profit >= 0 ? '4px 4px 0 0' : '0 0 4px 4px',
                  }} />
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            {months.map((m) => <div key={m.month} style={{ flex: 1, textAlign: 'center', fontSize: '11px', color: muted, overflow: 'hidden' }}>{label(m.month).slice(0, 3)}</div>)}
          </div>
        </>
      )}
    </section>
  )
}

// One bar per store: net profit £ with its net margin tier
function ProfitByChannel({ rows, ranges, moreHref }: { rows: (Metrics & { name: string; href: string })[]; ranges: Awaited<ReturnType<typeof loadMarginRanges>>; moreHref: string }) {
  const sorted = [...rows].sort((a, b) => b.netProfitPence - a.netProfitPence)
  const max = Math.max(1, ...sorted.map((r) => Math.abs(r.netProfitPence)))
  return (
    <section aria-label="Profit by channel" style={cardStyle}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
        <h2 style={cardTitle}>Profit by channel</h2>
        <Link href={moreHref} style={{ color: lime, fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>Channels →</Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {sorted.map((r) => (
          <Link key={r.href} href={r.href} title={`${r.name}: ${wholePounds(r.netProfitPence)} net profit, ${r.netMarginPercent ?? '—'}% net margin. Click for its products.`} style={{ color: text, textDecoration: 'none', minHeight: '28px', display: 'grid', gridTemplateColumns: 'minmax(90px, 180px) minmax(0, 1fr) 80px auto', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
            <div style={{ height: '18px', background: bg, borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(Math.abs(r.netProfitPence) / max) * 100}%`, background: r.netProfitPence < 0 ? red : chartProfit, borderRadius: '4px' }} />
            </div>
            <div style={{ fontSize: '14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{wholePounds(r.netProfitPence)}</div>
            <MarginPill value={r.netMarginPercent} ranges={ranges} />
          </Link>
        ))}
      </div>
      <p style={{ fontSize: '12px', color: muted, margin: '14px 0 0' }}>Bars: net profit £. Pill: net margin %.</p>
    </section>
  )
}

// Top 5 products by net profit £, and the weakest 5 by net margin %
async function ProductLists({ byProduct, names, opts, ranges, db, f }: {
  f: ReturnType<typeof parseFilters>
  byProduct: Map<string, Totals>
  names: Map<string, string>
  opts: { ads: boolean; overheads: boolean }
  ranges: Awaited<ReturnType<typeof loadMarginRanges>>
  db: Awaited<ReturnType<typeof createServerSupabase>>
}) {
  const all = [...byProduct].map(([id, t]) => ({ id, units: t.unitsSold, ...metrics(t, opts) }))
  const top = [...all].sort((a, b) => b.netProfitPence - a.netProfitPence).slice(0, 5)
  const topIds = new Set(top.map((p) => p.id))
  // No margin % (no revenue left, e.g. only ad spend or refunds) counts as weakest when it lost money
  const marginOrLoss = (p: (typeof all)[number]) => p.netMarginPercent ?? (p.netProfitPence < 0 ? -Infinity : Infinity)
  const weakest = all.filter((p) => !topIds.has(p.id)).sort((a, b) => marginOrLoss(a) - marginOrLoss(b)).slice(0, 5)

  const ids = [...top, ...weakest].map((p) => p.id)
  const { data } = ids.length ? await db.from('master_products').select('id, standard_sku').in('id', ids) : { data: [] }
  const skus = new Map<string, string>((data || []).map((p: { id: string; standard_sku: string }) => [p.id, p.standard_sku]))

  const list = (title: string, items: typeof all) => (
    <section aria-label={title} style={flexCard}>
      <h2 style={cardTitle}>{title}</h2>
      {items.length === 0 ? <p style={{ color: muted, margin: 0 }}>Nothing else sold in this period.</p> : items.map((p) => (
        <Link key={p.id} href={dashHref('/dashboards/sku', f, {}, { product: p.id })} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto', gap: '12px', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${border}`, color: text, textDecoration: 'none', minHeight: '44px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '14px' }}>{skus.get(p.id) || '—'}</div>
            <div style={{ color: muted, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names.get(p.id)}</div>
          </div>
          <span style={{ color: muted, fontSize: '13px', whiteSpace: 'nowrap' }}>{p.units.toLocaleString('en-GB')} units</span>
          <span style={{ fontSize: '14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: '64px' }}>{wholePounds(p.netProfitPence)}</span>
          <MarginPill value={p.netMarginPercent} ranges={ranges} />
        </Link>
      ))}
    </section>
  )

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
      {list('Top 5 products · net profit £', top)}
      {list('Weakest 5 products · net margin %', weakest)}
    </div>
  )
}
