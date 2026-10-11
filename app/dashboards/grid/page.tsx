import { connection } from 'next/server'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { createServerSupabase } from '@/lib/supabaseServer'
import { loadMarginRanges } from '@/lib/marginRanges'
import { loadStores, storeLabel } from '@/lib/stores'
import { fetchAll } from '@/lib/fetchAll'
import { parseFilters, profitBasis, ukRange, dashHref } from '@/lib/dashboardFilters'
import { loadDashboardPeriods, groupTotals, grandTotals, metrics, type Totals, type ProfitOptions } from '@/lib/dashboardTotals'
import { pounds } from '@/lib/format'
import { lime, bg, panel, border, red, amber, green, muted, dim, text, radius, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, inputStyle, marginTier, marginLegend } from '@/lib/theme'
import FilterBar from '@/components/dashboards/FilterBar'
import Delta from '@/components/dashboards/Delta'

const PATH = '/dashboards/grid'

// What each cell shows. The colour is always the net margin tier, so a healthy gross
// margin on a red cell says "the fees / shipping / ads are eating it".
const METRICS = {
  net: { label: 'Net margin %', short: 'Net %' },
  gross: { label: 'Gross margin %', short: 'Gross %' },
  ppu: { label: 'Net profit per unit £', short: '£ / unit' },
} as const
type MetricKey = keyof typeof METRICS

function metricValue(t: Totals | undefined, metric: MetricKey, opts: ProfitOptions): number | null {
  if (!t) return null
  const m = metrics(t, opts)
  return metric === 'net' ? m.netMarginPercent : metric === 'gross' ? m.grossMarginPercent : m.profitPerUnitPence
}
const showValue = (v: number | null, metric: MetricKey) => (v === null ? '—' : metric === 'ppu' ? pounds(v) : `${v}%`)

// A link when there's somewhere to go (the totals row has none)
function Wrap({ href, style, children }: { href?: string; style: CSSProperties; children: React.ReactNode }) {
  return href ? <Link href={href} style={style}>{children}</Link> : <div style={style}>{children}</div>
}

// Level 3 of the drill-down dashboards, the hub: "Which product, on which channel?"
export default async function SkuChannelGridPage({ searchParams }: PageProps<'/dashboards/grid'>) {
  // Render on every visit so the page shows live data, not a snapshot from build time
  await connection()
  const params = await searchParams
  const f = parseFilters(params)
  const opts = { ads: f.ads, overheads: f.overheads }
  const get = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '')
  const metric: MetricKey = get('metric') in METRICS ? (get('metric') as MetricKey) : 'net'
  const sort = get('sort') || 'all' // 'all', a store id, or 'sku'
  const dir = get('dir') === 'asc' ? 'asc' : 'desc'
  const search = get('q').trim()
  const showAll = get('show') === 'all'

  // This page's own settings (non-defaults only), kept by every link and by the filter bar
  const page: Record<string, string> = { metric: metric === 'net' ? '' : metric, sort: sort === 'all' ? '' : sort, dir: dir === 'desc' ? '' : dir, q: search, show: showAll ? 'all' : '' }
  const href = (changes: Record<string, string>) => dashHref(PATH, f, {}, { ...page, ...changes })

  const db = await createServerSupabase()
  const [ranges, stores, { current, previous, error }, listings] = await Promise.all([
    loadMarginRanges(db),
    loadStores(db),
    loadDashboardPeriods(f, db),
    // Which products are listed in which stores, so "not listed" differs from "no sales"
    fetchAll((from, to) => db.from('platform_listings').select('id, master_product_id, store_id, master_products(name, standard_sku)').order('id').range(from, to)),
  ])
  if (error || !current) return <div style={{ ...pageStyle, color: red }}>Error: {error}</div>
  if (listings.error) return <div style={{ ...pageStyle, color: red }}>Error: {listings.error.message}</div>

  // Sum pence per product × store, per product, per store FIRST; every % comes from these
  const sum = (p: typeof current) => ({
    cell: groupTotals(p, { row: (r) => `${r.master_product_id}|${r.store_id}`, ad: (l) => `${l.master_product_id}|${l.store_id}` }),
    product: groupTotals(p, { row: (r) => r.master_product_id, ad: (l) => l.master_product_id }),
    store: groupTotals(p, { row: (r) => r.store_id, ad: (l) => l.store_id }),
    all: grandTotals(p),
  })
  const now = sum(current)
  const before = previous ? sum(previous) : null

  // Products and stores: from the listings, plus anything that sold (or had ad spend)
  const products = new Map<string, { name: string; sku: string }>()
  const listed = new Set<string>()
  const storeIds = new Set<string>()
  for (const l of listings.data as unknown as { master_product_id: string; store_id: string; master_products: { name: string; standard_sku: string } | null }[]) {
    products.set(l.master_product_id, { name: l.master_products?.name ?? '?', sku: l.master_products?.standard_sku ?? '' })
    listed.add(`${l.master_product_id}|${l.store_id}`)
    storeIds.add(l.store_id)
  }
  for (const r of current.rows) {
    if (!products.has(r.master_product_id)) products.set(r.master_product_id, { name: r.product_name, sku: '' })
    storeIds.add(r.store_id)
  }
  for (const a of current.ads) if (!products.has(a.master_product_id)) products.set(a.master_product_id, { name: a.product_name, sku: a.standard_sku })

  // Columns: every store with a listing or sale (just the chosen one when filtered), by channel then name
  const columns = stores
    .filter((s) => (f.store ? s.id === f.store : storeIds.has(s.id)))
    .map((s) => ({ id: s.id, platform: s.platforms?.name ?? '', name: s.name, label: storeLabel(s) }))
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name))
  // Headings show the channel; the store name too when two columns share a channel (e.g. Amazon + Amazon FBA)
  const perPlatform = new Map<string, number>()
  for (const c of columns) perPlatform.set(c.platform, (perPlatform.get(c.platform) || 0) + 1)

  // Rows: products with sales / ad spend in the period (in the chosen store), unless "Show all"
  const allIds = [...products.keys()].filter((id) => !f.store || listed.has(`${id}|${f.store}`) || now.product.has(id))
  const needle = search.toLowerCase()
  const rows = allIds
    .filter((id) => showAll || now.product.has(id))
    .filter((id) => !needle || products.get(id)!.sku.toLowerCase().includes(needle) || products.get(id)!.name.toLowerCase().includes(needle))
  const sortValue = (id: string) => metricValue(sort === 'all' ? now.product.get(id) : now.cell.get(`${id}|${sort}`), metric, opts)
  const byName = (a: string, b: string) => (products.get(a)!.sku || products.get(a)!.name).localeCompare(products.get(b)!.sku || products.get(b)!.name)
  rows.sort((a, b) => {
    if (sort === 'sku') return dir === 'desc' ? byName(a, b) : byName(b, a)
    const va = sortValue(a)
    const vb = sortValue(b)
    if (va === null || vb === null) return va === null ? (vb === null ? byName(a, b) : 1) : -1 // blanks last
    return dir === 'desc' ? vb - va : va - vb
  })

  const legend = marginLegend(ranges)
  const deltaKind = metric === 'ppu' ? 'money' : 'points'

  // ---- Layout: fixed-width columns, SKU column and heading row pinned while scrolling ----
  const SKU_COL = 230
  const COL = 112
  const GAP = 5
  const showAllColumn = columns.length > 1
  const pinned: CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: panel }
  const head: CSSProperties = { fontSize: '11px', color: muted, fontWeight: 600, padding: '4px 2px', textAlign: 'center', verticalAlign: 'bottom', position: 'sticky', top: 0, zIndex: 2, background: panel, boxShadow: `0 0 0 ${GAP}px ${panel}` }
  const oneLine: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  const box = (tierBg: string, fg: string): CSSProperties => ({ background: tierBg, color: fg, textAlign: 'center', padding: '7px 4px', borderRadius: '10px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden' })

  // Clicking a heading sorts by it (best first); clicking it again flips the order
  const sortHeading = (column: string, children: React.ReactNode, extraStyle: CSSProperties = {}) => {
    const on = sort === column
    return (
      <Link href={href({ sort: column === 'all' ? '' : column, dir: on && dir === 'desc' ? 'asc' : '' })} style={{ color: on ? lime : text, textDecoration: 'none', display: 'block', ...extraStyle }} title="Sort by this column">
        {children}
        <div style={{ fontSize: '11px', color: on ? lime : dim, fontWeight: 700 }}>{on ? (column === 'sku' ? (dir === 'desc' ? 'A–Z' : 'Z–A') : dir === 'desc' ? 'best first ↓' : 'worst first ↑') : ' '}</div>
      </Link>
    )
  }

  // link: where clicking the cell goes (SKU detail with that channel highlighted)
  const cell = (key: string, t: Totals | undefined, prior: Totals | undefined, isListed: boolean, bold = false, link?: string) => {
    if (!t) {
      return isListed
        ? <td key={key} style={{ ...box('transparent', dim), border: `1px solid ${border}`, fontSize: '11px' }} title="Listed, no sales in this period">no sales</td>
        : <td key={key} style={{ ...box('transparent', dim), border: `1px dashed ${border}`, fontSize: '11px' }} title="Not listed in this store">Not listed</td>
    }
    const m = metrics(t, opts)
    const tier = marginTier(m.netMarginPercent, ranges)
    const value = metricValue(t, metric, opts)
    return (
      <td key={key} style={{ ...box(tier.bg, tier.fg), padding: 0 }} title={`Net margin ${m.netMarginPercent ?? '—'}% · net profit ${pounds(m.netProfitPence)} · ${t.unitsSold} sold`}>
        <Wrap href={link} style={{ display: 'block', padding: '7px 4px', color: tier.fg, textDecoration: 'none' }}>
          <div style={{ fontSize: '15px', fontWeight: 800 }}>{showValue(value, metric)}</div>
          <div style={{ fontSize: '11px', color: text, fontWeight: bold ? 700 : 500 }}>{t.unitsSold.toLocaleString('en-GB')} sold</div>
          {f.compare && <div style={{ fontSize: '11px', fontWeight: 700 }}><Delta compact current={value} previous={metricValue(prior, metric, opts)} kind={deltaKind} /></div>}
        </Wrap>
      </td>
    )
  }

  const pill = (on: boolean): CSSProperties => ({ fontSize: '12px', fontWeight: 700, padding: '7px 14px', borderRadius: radius, textDecoration: 'none', background: on ? lime : 'transparent', color: on ? bg : muted, border: `1px solid ${on ? lime : border}`, whiteSpace: 'nowrap' })
  const tableWidth = SKU_COL + (columns.length + (showAllColumn ? 1 : 0)) * COL + (columns.length + 3) * GAP

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Level 3 · Which product, on which channel?</p>
      <h1 style={pageTitle}>SKU × Channel</h1>
      <p style={pageIntro}>
        Every product in every store, {ukRange(f)}. Net profit {profitBasis(f)}, net of refunds. Each figure is worked out from that cell&apos;s totals, never averaged.
      </p>

      <FilterBar key={`${f.from}|${f.to}`} path={PATH} filters={f} stores={stores.map((s) => ({ id: s.id, label: storeLabel(s) }))} extra={page} />

      <div style={cardStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 20px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div role="group" aria-label="Figure shown" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {(Object.keys(METRICS) as MetricKey[]).map((k) => (
              <Link key={k} href={href({ metric: k === 'net' ? '' : k })} style={pill(metric === k)} aria-pressed={metric === k}>{METRICS[k].label}</Link>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: '12px', color: muted, alignItems: 'center' }}>
            <span>Colour = net margin:</span>
            <span><span style={{ color: red }}>●</span> {legend[0]}</span>
            <span><span style={{ color: amber }}>●</span> {legend[1]}</span>
            <span><span style={{ color: green }}>●</span> {legend[2]}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px', alignItems: 'center', marginBottom: '14px' }}>
          <form action={PATH} method="get" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {Object.entries(Object.fromEntries(new URLSearchParams(href({ q: '' }).split('?')[1] ?? ''))).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="search" name="q" defaultValue={search} placeholder="Search SKU or product" aria-label="Search SKU or product" style={{ ...inputStyle, width: '240px', maxWidth: '100%' }} />
            {search && <Link href={href({ q: '' })} style={{ color: muted, fontSize: '12px' }}>Clear</Link>}
          </form>
          <Link href={href({ dir: dir === 'desc' ? 'asc' : '' })} style={pill(dir === 'asc' && sort !== 'sku')}>Worst first</Link>
          <span style={{ fontSize: '12px', color: muted }}>
            {rows.length} {rows.length === 1 ? 'product' : 'products'}{showAll ? '' : ' with sales in this period'}{search ? ` matching “${search}”` : ''}.{' '}
            <Link href={href({ show: showAll ? '' : 'all' })} style={{ color: lime }}>{showAll ? 'Only products with sales' : 'Show all products'}</Link>
          </span>
        </div>

        {rows.length === 0 ? (
          <p style={{ color: muted }}>No products to show. Try a longer date range{search ? ' or a different search' : ''}.</p>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 160px)', scrollbarWidth: 'thin', scrollbarColor: `${border} transparent` }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: `${GAP}px`, tableLayout: 'fixed', width: `${tableWidth}px` }}>
              <colgroup>
                <col style={{ width: `${SKU_COL}px` }} />
                {showAllColumn && <col style={{ width: `${COL}px` }} />}
                {columns.map((c) => <col key={c.id} style={{ width: `${COL}px` }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...head, ...pinned, zIndex: 3, textAlign: 'left', fontSize: '12px' }}>{sortHeading('sku', 'SKU / Product')}</th>
                  {showAllColumn && <th style={head}>{sortHeading('all', <div style={{ fontWeight: 800, fontSize: '12px' }}>All stores</div>)}</th>}
                  {columns.map((c) => (
                    <th key={c.id} style={head} title={c.label}>
                      {sortHeading(c.id, <>
                        <div style={{ ...oneLine, fontWeight: 800, fontSize: '12px' }}>{c.platform || c.name}</div>
                        <div style={{ ...oneLine, color: muted }}>{c.platform && (perPlatform.get(c.platform) || 0) > 1 ? c.name : ' '}</div>
                      </>)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((id) => {
                  const p = products.get(id)!
                  return (
                    <tr key={id}>
                      <th scope="row" style={{ ...pinned, padding: '4px', textAlign: 'left', fontWeight: 800 }}>
                        <Link href={dashHref('/dashboards/sku', f, {}, { product: id })} title={`${p.sku} ${p.name}: see why it makes (or loses) money`} style={{ color: text, textDecoration: 'none', display: 'block' }}>
                          <div style={{ ...oneLine, fontSize: '13px' }}>{p.sku || '—'}</div>
                          <div style={{ ...oneLine, fontSize: '12px', fontWeight: 500, color: muted }}>{p.name}</div>
                        </Link>
                      </th>
                      {showAllColumn && cell('all', now.product.get(id), before?.product.get(id), true, true, dashHref('/dashboards/sku', f, {}, { product: id }))}
                      {columns.map((c) => cell(c.id, now.cell.get(`${id}|${c.id}`), before?.cell.get(`${id}|${c.id}`), listed.has(`${id}|${c.id}`), false, dashHref('/dashboards/sku', f, {}, { product: id, channel: c.id })))}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" style={{ ...pinned, padding: '8px 4px', textAlign: 'left', fontSize: '13px', fontWeight: 800, borderTop: `1px solid ${border}` }}>
                    Whole store
                    <div style={{ fontSize: '11px', color: muted, fontWeight: 500 }}>every product, not just these rows</div>
                  </th>
                  {showAllColumn && cell('all', now.all, before?.all, true, true)}
                  {columns.map((c) => cell(c.id, now.store.get(c.id), before?.store.get(c.id), true, true))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p style={{ fontSize: '12px', color: dim, margin: '12px 0 0' }}>
          Each cell: {METRICS[metric].label.toLowerCase()}, units sold{f.compare ? ', and the change vs the period before' : ''}. Click a heading to sort by it.
          No sales = listed in that store but nothing sold in this period. Not listed = not mapped in that store. Click a product or cell for its SKU detail.
        </p>
      </div>
    </div>
  )
}
