import { connection } from 'next/server'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { createServerSupabase } from '@/lib/supabaseServer'
import { loadStores, storeLabel } from '@/lib/stores'
import { parseFilters, priorRange, ukRange } from '@/lib/dashboardFilters'
import { loadAlerts, type Alert } from '@/lib/alerts'
import { wholePounds } from '@/lib/format'
import { lime, red, amber, muted, text, border, panel, panelRaised, radius, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle } from '@/lib/theme'
import FilterBar from '@/components/dashboards/FilterBar'
import KpiCard from '@/components/dashboards/KpiCard'
import AlertRules from '@/components/dashboards/AlertRules'

const PATH = '/dashboards/alerts'

// Badge colours: losses red, getting-worse warnings amber, data problems neutral (always with a label)
const BADGE: Record<Alert['rule'], { bg: string; fg: string }> = {
  loss: { bg: 'rgba(255,76,76,0.16)', fg: red },
  margin_drop: { bg: 'rgba(255,176,32,0.15)', fg: amber },
  acos: { bg: 'rgba(255,176,32,0.15)', fg: amber },
  fee_change: { bg: 'rgba(255,176,32,0.15)', fg: amber },
  missing_costs: { bg: panelRaised, fg: text },
  stale_import: { bg: panelRaised, fg: muted },
}

// Cross-cutting: "What should I fix today?" Every alert links to the page that fixes it.
export default async function AlertsPage({ searchParams }: PageProps<'/dashboards/alerts'>) {
  // Render on every visit so the page shows live data, not a snapshot from build time
  await connection()
  const f = parseFilters(await searchParams)
  const db = await createServerSupabase()
  const [stores, result] = await Promise.all([loadStores(db), loadAlerts(f, db)])
  if ('error' in result) return <div style={{ ...pageStyle, color: red }}>Error: {result.error}</div>
  const { alerts, rules, rulesSaved, lastOrders, notes } = result
  const prior = priorRange(f)

  const of = (...codes: Alert['rule'][]) => alerts.filter((a) => codes.includes(a.rule))
  const monthly = (list: Alert[]) => list.reduce((s, a) => s + (a.impactPence ?? 0), 0)
  const losses = of('loss')
  const warnings = of('margin_drop', 'acos', 'fee_change')
  const gaps = of('missing_costs')
  const newest = lastOrders[0]
  const oldest = lastOrders[lastOrders.length - 1]

  const button: CSSProperties = { border: `1px solid ${lime}`, color: lime, borderRadius: radius, padding: '10px 14px', textDecoration: 'none', fontWeight: 700, fontSize: '13px', whiteSpace: 'nowrap', minHeight: '44px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center' }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>All levels · What should I fix today?</p>
      <h1 style={pageTitle}>Alerts</h1>
      <p style={pageIntro}>
        {ukRange(f)} compared with {ukRange(prior)}. £ figures are a month&apos;s worth at this period&apos;s rate. Every alert links to the page that fixes it.
      </p>

      <FilterBar key={`${f.from}|${f.to}`} path={PATH} filters={f} stores={stores.map((s) => ({ id: s.id, label: storeLabel(s) }))} />

      <section aria-label="Alert summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px', marginTop: '24px' }}>
        <KpiCard label="Losing money" value={String(losses.length)} valueColor={losses.length ? red : text}>
          <span style={{ color: muted }}>{losses.length ? `≈ ${wholePounds(monthly(losses))} / month leaking` : 'Nothing selling at a loss'}</span>
        </KpiCard>
        <KpiCard label="Getting worse" value={String(warnings.length)} valueColor={warnings.length ? amber : text}>
          <span style={{ color: muted }}>{warnings.length ? `margin, ads or fees · ≈ ${wholePounds(monthly(warnings))} / month` : 'Margins, ads and fees steady'}</span>
        </KpiCard>
        <KpiCard label="Data gaps" value={String(gaps.length)}>
          <span style={{ color: muted }}>{gaps.length ? `product${gaps.length === 1 ? '' : 's'} with missing costs: figures overstated` : 'Every order has its costs'}</span>
        </KpiCard>
        <KpiCard label="Newest order" value={newest ? (newest.days === 0 ? 'Today' : `${newest.days} day${newest.days === 1 ? '' : 's'} ago`) : '—'}>
          <span style={{ color: muted }}>{oldest && oldest !== newest ? `${newest.name} · oldest: ${oldest.name} ${oldest.days} days` : newest ? newest.name : 'No orders yet'}</span>
        </KpiCard>
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-start' }}>
        <section aria-label="Alert list" style={{ ...cardStyle, flex: '999 1 600px', minWidth: 0, padding: '8px 22px' }}>
          {alerts.length === 0 ? (
            <p style={{ color: muted, padding: '14px 0', margin: 0 }}>No alerts for this period.</p>
          ) : alerts.map((a, i) => (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center', padding: '14px 0', borderBottom: i < alerts.length - 1 ? `1px solid ${border}` : 'none' }}>
              <span style={{ background: BADGE[a.rule].bg, color: BADGE[a.rule].fg, borderRadius: radius, padding: '3px 8px', fontSize: '12px', fontWeight: 800, minWidth: '72px', textAlign: 'center' }}>{a.badge}</span>
              <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>{a.title}</div>
                <div style={{ fontSize: '13px', color: muted }}>{a.detail}</div>
              </div>
              <div style={{ fontSize: '14px', fontVariantNumeric: 'tabular-nums', minWidth: '100px', textAlign: 'right' }}>
                {a.impactPence !== null && a.impactPence > 0 ? <>≈ {wholePounds(a.impactPence)}<span style={{ color: muted }}> / mo</span></> : ''}
              </div>
              <Link href={a.href} style={button}>{a.action} →</Link>
            </div>
          ))}
          {notes.map((n) => <p key={n} style={{ fontSize: '12px', color: muted, margin: '0 0 12px' }}>{n}</p>)}
        </section>

        <AlertRules rules={rules} canSave={rulesSaved} />
      </div>

      {lastOrders.length > 0 && (
        <section aria-label="Newest order per store" style={{ ...cardStyle, background: panel }}>
          <div style={{ fontSize: '13px', color: muted, marginBottom: '8px' }}>Newest order per store</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', fontSize: '13px' }}>
            {lastOrders.map((s) => <span key={s.storeId}>{s.name}: <span style={{ color: s.days > (rules.find((r) => r.code === 'stale_import')?.threshold ?? 7) ? amber : text }}>{s.days === 0 ? 'today' : `${s.days}d ago`}</span></span>)}
          </div>
        </section>
      )}
    </div>
  )
}
