import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { fetchAll } from './fetchAll'
import { loadStores, storeLabel, type Store } from './stores'
import { dashHref, rangeDays, todayIso, type DashboardFilters } from './dashboardFilters'
import { loadDashboardPeriods, groupTotals, metrics, breakEvenAcos, type PeriodData, type Totals } from './dashboardTotals'
import { pounds, ukDate } from './format'
import { ALERT_RULES, type RuleCode, type RuleSetting } from './alertRules'

export { ALERT_RULES, type RuleCode, type RuleSetting }

// "What should I fix today?" Worked out on page load from the same totals as the dashboards:
// the filters' period compared with the one before (always, whatever the compare toggle says).
// Each business can switch rules off or change a threshold (table alert_rules; no row = the
// defaults in lib/alertRules.ts).

export type Alert = {
  rule: RuleCode
  badge: string
  title: string
  detail: string
  impactPence: number | null // £ a month this is costing (scaled from the period); null = not a £ figure
  href: string
  action: string
}

export type AlertsResult = {
  alerts: Alert[]
  rules: RuleSetting[]
  rulesSaved: boolean // false = the alert_rules table isn't there yet (migration not run)
  lastOrders: { storeId: string; name: string; date: string; days: number }[] // newest first
  notes: string[]
}

// The import page for a store's channel
function importPage(store: Store | undefined): string {
  const name = (store?.platforms?.name ?? '').toLowerCase()
  const type = store?.platforms?.integration_type ?? ''
  if (name.includes('amazon')) return '/amazon-import'
  if (name.includes('tiktok')) return '/tiktok-import'
  if (name.includes('ebay') || type === 'ebay') return '/ebay-import'
  if (name.includes('temu') || type === 'temu') return '/temu-import'
  if (name.includes('onbuy')) return '/onbuy-import'
  if (name.includes('shopify')) return '/shopify-import'
  if (type === 'mirakl') return '/mirakl-import'
  return '/upload'
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

// Pass the dashboard's periods when it has already loaded them (with a comparison)
export async function loadAlerts(
  f: DashboardFilters,
  db: SupabaseClient = supabase,
  loaded?: { current: PeriodData; previous: PeriodData }
): Promise<AlertsResult | { error: string }> {
  const [periods, stores, ruleRows, missing, lastOrders] = await Promise.all([
    loaded ? { ...loaded, error: null } : loadDashboardPeriods({ ...f, compare: true }, db),
    loadStores(db),
    db.from('alert_rules').select('rule_code, enabled, threshold'),
    fetchAll((from, to) =>
      db.from('order_margins').select('order_line_item_id, master_product_id, product_name, store_id, product_cost_pence, shipping_source')
        .or('product_cost_pence.eq.0,shipping_source.eq.missing').order('order_line_item_id').range(from, to)
    ),
    db.rpc('store_last_order_dates'),
  ])
  if (periods.error || !periods.current || !periods.previous) return { error: periods.error ?? 'Could not load the figures' }
  const { current, previous } = periods
  const notes: string[] = []

  // Settings: saved rows over the defaults
  const saved = new Map<string, { enabled: boolean; threshold: number | null }>()
  for (const r of ruleRows.data || []) saved.set(r.rule_code, { enabled: r.enabled, threshold: r.threshold === null ? null : Number(r.threshold) })
  const rules: RuleSetting[] = ALERT_RULES.map((r) => ({
    code: r.code,
    enabled: saved.get(r.code)?.enabled ?? true,
    threshold: saved.get(r.code)?.threshold ?? r.threshold?.default ?? 0,
  }))
  const rule = (code: RuleCode) => rules.find((r) => r.code === code)!
  const on = (code: RuleCode) => rule(code).enabled

  const storeOf = (id: string) => stores.find((s) => s.id === id)
  const opts = { ads: f.ads, overheads: f.overheads }
  const perMonth = (pence: number) => Math.round((pence * 30.4) / rangeDays(f)) // the period's £ as a month's worth
  const skuHref = (productId: string, storeId: string) => dashHref('/dashboards/sku', f, {}, { product: productId, channel: storeId })

  // Per product × store, both periods
  const key = { row: (r: { master_product_id: string; store_id: string }) => `${r.master_product_id}|${r.store_id}`, ad: (l: { master_product_id: string; store_id: string }) => `${l.master_product_id}|${l.store_id}` }
  const now = groupTotals(current, key)
  const before = groupTotals(previous, key)
  const names = new Map<string, string>()
  for (const r of [...current.rows, ...previous.rows]) names.set(r.master_product_id, r.product_name)
  for (const l of current.ads) if (!names.has(l.master_product_id)) names.set(l.master_product_id, l.product_name)
  const productIds = [...new Set([...now.keys()].map((k) => k.split('|')[0]))]
  const { data: skuRows } = productIds.length ? await db.from('master_products').select('id, standard_sku').in('id', productIds) : { data: [] }
  const skus = new Map<string, string>((skuRows || []).map((p: { id: string; standard_sku: string }) => [p.id, p.standard_sku]))
  const label = (productId: string) => skus.get(productId) || names.get(productId) || 'Product'

  const alerts: Alert[] = []
  for (const [k, t] of now) {
    const [productId, storeId] = k.split('|')
    const store = storeLabel(storeOf(storeId))
    const m = metrics(t, opts)
    const prior: Totals | undefined = before.get(k)
    const pm = prior ? metrics(prior, opts) : null
    const loss = m.netProfitPence < 0 && (t.unitsSold > 0 || t.adCostPence > 0)

    if (on('loss') && loss) {
      alerts.push({
        rule: 'loss', badge: 'Loss', title: `${label(productId)} loses money on ${store}`,
        detail: `${pounds(m.netProfitPence)} net profit on ${t.unitsSold} sold${m.netMarginPercent !== null ? ` (${m.netMarginPercent}% net margin)` : ''}`,
        impactPence: perMonth(-m.netProfitPence), href: skuHref(productId, storeId), action: 'See why',
      })
    }

    // A few units either side, so one odd order doesn't raise an alert
    const enough = t.unitsSold >= 3 && (prior?.unitsSold ?? 0) >= 3
    if (on('margin_drop') && !loss && enough && m.netMarginPercent !== null && pm?.netMarginPercent != null) {
      const drop = Math.round((pm.netMarginPercent - m.netMarginPercent) * 10) / 10
      if (drop >= rule('margin_drop').threshold) {
        alerts.push({
          rule: 'margin_drop', badge: 'Margin', title: `${label(productId)} on ${store}: margin down ${drop} pts`,
          detail: `${pm.netMarginPercent}% → ${m.netMarginPercent}% net margin vs the period before`,
          impactPence: perMonth((drop / 100) * t.revenuePence), href: skuHref(productId, storeId), action: 'See why',
        })
      }
    }

    if (on('acos') && t.adSpendPence > 0 && m.acosPercent !== null) {
      const be = breakEvenAcos(t, opts, !!storeOf(storeId)?.vat_registered)
      if (be !== null && m.acosPercent > be) {
        // What the ads cost beyond the profit they had to spend
        const beforeAds = t.marginPence - (opts.overheads ? t.overheadPence : 0)
        alerts.push({
          rule: 'acos', badge: 'Ads', title: `${label(productId)} on ${store}: ACOS ${m.acosPercent}% vs break-even ${be}%`,
          detail: `${pounds(t.adCostPence)} ad spend against ${pounds(Math.max(0, beforeAds))} profit before ads`,
          impactPence: perMonth(t.adCostPence - Math.max(0, beforeAds)), href: skuHref(productId, storeId), action: 'See why',
        })
      }
    }

    if (on('fee_change') && current.costSplit && previous.costSplit && enough && prior!.feesPence > 0) {
      const nowPer = t.feesPence / t.unitsSold
      const priorPer = prior!.feesPence / prior!.unitsSold
      const change = Math.round(((nowPer - priorPer) / priorPer) * 1000) / 10
      if (change >= rule('fee_change').threshold && nowPer - priorPer >= 5) {
        alerts.push({
          rule: 'fee_change', badge: 'Fees', title: `${label(productId)} on ${store}: fees per unit up ${change}%`,
          detail: `${pounds(Math.round(priorPer))} → ${pounds(Math.round(nowPer))} per unit sold vs the period before`,
          impactPence: perMonth((nowPer - priorPer) * t.unitsSold), href: skuHref(productId, storeId), action: 'See why',
        })
      }
    }
  }

  // Data gaps (all dates: they make every total wrong), one alert per product
  if (on('missing_costs')) {
    if (missing.error) notes.push(`Missing costs couldn't be checked: ${missing.error.message}`)
    const gaps = new Map<string, { name: string; noCost: number; noShipping: number }>()
    for (const r of missing.data as { master_product_id: string; product_name: string; store_id: string; product_cost_pence: number; shipping_source: string }[]) {
      if (f.store && r.store_id !== f.store) continue
      const g = gaps.get(r.master_product_id) || { name: r.product_name, noCost: 0, noShipping: 0 }
      if (Number(r.product_cost_pence) === 0) g.noCost++
      if (r.shipping_source === 'missing') g.noShipping++
      gaps.set(r.master_product_id, g)
    }
    for (const [productId, g] of gaps) {
      const parts = [g.noCost && `${g.noCost} with no product cost`, g.noShipping && `${g.noShipping} with no shipping cost`].filter(Boolean)
      alerts.push({
        rule: 'missing_costs', badge: 'Data gap', title: `${skus.get(productId) || g.name}: orders missing costs`,
        detail: `${parts.join(', ')} (all dates). Margins are overstated until it's added or backdated.`,
        impactPence: null, href: `/products/${productId}`, action: 'Add costs',
      })
    }
  }

  // Import overdue: each store's newest order
  const today = todayIso()
  const latest = ((lastOrders.data || []) as { store_id: string; last_order_date: string }[])
    .filter((r) => !f.store || r.store_id === f.store)
    .map((r) => ({ storeId: r.store_id, name: storeLabel(storeOf(r.store_id)), date: r.last_order_date, days: daysBetween(r.last_order_date, today) }))
    .sort((a, b) => a.days - b.days)
  if (lastOrders.error) notes.push('Import ages need the database update 20261011140000_alert_rules.sql.')
  else if (on('stale_import')) {
    const limit = rule('stale_import').threshold
    for (const s of latest.filter((s) => s.days > limit)) {
      alerts.push({
        rule: 'stale_import', badge: 'Import', title: `${s.name}: newest order is ${s.days} days old`,
        detail: `Last order ${ukDate(s.date)}. Recent sales won't show until the next report is imported.`,
        impactPence: null, href: importPage(storeOf(s.storeId)), action: 'Import',
      })
    }
  }
  if (ruleRows.error) notes.push('Rule settings need the database update 20261011140000_alert_rules.sql (using the defaults for now).')

  // Biggest £ first, then data gaps, then imports
  const order: RuleCode[] = ['loss', 'acos', 'margin_drop', 'fee_change', 'missing_costs', 'stale_import']
  alerts.sort((a, b) => (b.impactPence ?? -1) - (a.impactPence ?? -1) || order.indexOf(a.rule) - order.indexOf(b.rule))

  return { alerts, rules, rulesSaved: !ruleRows.error, lastOrders: latest, notes }
}
