import { connection } from 'next/server'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { createServerSupabase } from '@/lib/supabaseServer'
import { loadMarginRanges } from '@/lib/marginRanges'
import { loadStores, storeLabel, type Store } from '@/lib/stores'
import { parseFilters, profitBasis, ukRange, dashHref, todayIso, type DashboardFilters } from '@/lib/dashboardFilters'
import { loadDashboardPeriods, loadPeriods, loadMonthlyPeriods, filterPeriod, groupTotals, grandTotals, metrics, breakEvenAcos, type Totals, type ProfitOptions } from '@/lib/dashboardTotals'
import { pounds, wholePounds, ukDate } from '@/lib/format'
import { lime, red, muted, dim, text, border, panelRaised, chartProfit, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, inputStyle, primaryButton, type MarginRanges } from '@/lib/theme'
import FilterBar from '@/components/dashboards/FilterBar'
import KpiCard from '@/components/dashboards/KpiCard'
import Delta from '@/components/dashboards/Delta'
import MarginPill from '@/components/dashboards/MarginPill'
import MoneyBridge from '@/components/dashboards/MoneyBridge'

const PATH = '/dashboards/sku'
type Db = Awaited<ReturnType<typeof createServerSupabase>>

// Level 4 of the drill-down dashboards: "Why is this product making (or losing) money?"
//   ?product=<id>   the product (no product, or a search = pick one from a list)
//   &channel=<id>   the store highlighted, and used for the one-unit breakdown
export default async function SkuDetailPage({ searchParams }: PageProps<'/dashboards/sku'>) {
  // Render on every visit so the page shows live data, not a snapshot from build time
  await connection()
  const params = await searchParams
  const f = parseFilters(params)
  const opts = { ads: f.ads, overheads: f.overheads }
  const get = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '')
  const productId = get('product')
  const search = get('q').trim()

  const db = await createServerSupabase()
  const [stores, ranges] = await Promise.all([loadStores(db), loadMarginRanges(db)])
  const storeOptions = stores.map((s) => ({ id: s.id, label: storeLabel(s) }))

  if (!productId || search) {
    return (
      <div style={pageStyle}>
        <Heading f={f} />
        <FilterBar key={`${f.from}|${f.to}`} path={PATH} filters={f} stores={storeOptions} extra={{ q: search }} />
        <ProductPicker f={f} opts={opts} search={search} ranges={ranges} db={db} />
      </div>
    )
  }
  return <ProductDetail f={f} opts={opts} productId={productId} channel={get('channel')} stores={stores} storeOptions={storeOptions} ranges={ranges} db={db} />
}

function Heading({ f, product, editHref }: { f: DashboardFilters; product?: { sku: string; name: string }; editHref?: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px' }}>
      <div style={{ minWidth: 0 }}>
        <p style={eyebrow}>
          <Link href={dashHref('/dashboards/grid', f)} style={{ color: lime, textDecoration: 'none' }}>← SKU × Channel</Link> · Level 4 · Why is this product making (or losing) money?
        </p>
        <h1 style={pageTitle}>
          {product ? product.sku || 'Product' : 'SKU detail'}
          {product && <span style={{ fontWeight: 500, fontStretch: '100%', textTransform: 'none', fontSize: '20px', color: muted, marginLeft: '12px', letterSpacing: 0 }}>{product.name}</span>}
        </h1>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        <form action={PATH} method="get" style={{ display: 'flex', gap: '8px' }}>
          {Object.entries(Object.fromEntries(new URLSearchParams(dashHref(PATH, f).split('?')[1] ?? ''))).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="search" name="q" placeholder="Find SKU or product" aria-label="Find SKU or product" style={{ ...inputStyle, width: '200px', minHeight: '40px', boxSizing: 'border-box' }} />
        </form>
        {editHref && <Link href={editHref} style={{ ...primaryButton, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: '40px', boxSizing: 'border-box' }}>Edit costs</Link>}
      </div>
    </div>
  )
}

// No product chosen (or a search): products with sales in the period, best first, or the matches
async function ProductPicker({ f, opts, search, ranges, db }: { f: DashboardFilters; opts: ProfitOptions; search: string; ranges: MarginRanges; db: Db }) {
  const { periods, error } = await loadPeriods([{ from: f.from, to: f.to }], f, db)
  if (error) return <p style={{ color: red }}>Error: {error}</p>
  const byProduct = groupTotals(periods[0], { row: (r) => r.master_product_id, ad: (l) => l.master_product_id })

  // Characters that would break the search filter are left out
  const term = search.replace(/[,()%*\\]/g, ' ').trim()
  let ids: string[]
  const products = new Map<string, { sku: string; name: string }>()
  if (term) {
    const { data } = await db.from('master_products').select('id, name, standard_sku').or(`standard_sku.ilike.%${term}%,name.ilike.%${term}%`).order('standard_sku').limit(60)
    for (const p of data || []) products.set(p.id, { sku: p.standard_sku, name: p.name })
    ids = [...products.keys()]
  } else {
    ids = [...byProduct.keys()].sort((a, b) => metrics(byProduct.get(b)!, opts).netProfitPence - metrics(byProduct.get(a)!, opts).netProfitPence)
    const { data } = ids.length ? await db.from('master_products').select('id, name, standard_sku').in('id', ids) : { data: [] }
    for (const p of data || []) products.set(p.id, { sku: p.standard_sku, name: p.name })
  }

  return (
    <section style={cardStyle} aria-label="Pick a product">
      <h2 style={cardTitle}>{term ? `Products matching “${search}”` : `Products with sales, ${ukRange(f)} · best net profit first`}</h2>
      {ids.length === 0 && <p style={{ color: muted, margin: 0 }}>{term ? 'No products match.' : 'No sales in this period. Try a longer date range.'}</p>}
      {ids.map((id) => {
        const p = products.get(id)
        const t = byProduct.get(id)
        const m = t ? metrics(t, opts) : null
        return (
          <Link key={id} href={dashHref(PATH, f, {}, { product: id })} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto', gap: '12px', alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${border}`, color: text, textDecoration: 'none', minHeight: '44px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>{p?.sku || '—'}</div>
              <div style={{ color: muted, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p?.name}</div>
            </div>
            <span style={{ color: muted, fontSize: '13px', whiteSpace: 'nowrap' }}>{t ? `${t.unitsSold.toLocaleString('en-GB')} sold` : 'no sales'}</span>
            <span style={{ fontSize: '14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', minWidth: '64px' }}>{m ? wholePounds(m.netProfitPence) : ''}</span>
            <MarginPill value={m?.netMarginPercent ?? null} ranges={ranges} />
          </Link>
        )
      })}
    </section>
  )
}

type CostRow = { component_type: string; description: string | null; amount_pence: number; effective_from: string; store_id: string | null; cost_types: { label: string; in_gross: boolean } | null }
type RuleRow = { qty: number; courier_cost_pence: number; effective_from: string; store_id: string | null }

async function ProductDetail({ f, opts, productId, channel, stores, storeOptions, ranges, db }: {
  f: DashboardFilters
  opts: ProfitOptions
  productId: string
  channel: string
  stores: Store[]
  storeOptions: { id: string; label: string }[]
  ranges: MarginRanges
  db: Db
}) {
  // The margin history always shows the last 12 months up to today
  const today = todayIso()
  const trendFrom = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 12, 1)).toISOString().slice(0, 10)

  const [{ data: product }, periods, trend, { data: listings }, { data: costs }, { data: rules }] = await Promise.all([
    db.from('master_products').select('id, name, standard_sku').eq('id', productId).maybeSingle(),
    loadDashboardPeriods(f, db),
    loadMonthlyPeriods({ from: trendFrom, to: today }, f, db),
    db.from('platform_listings').select('id, store_id, platform_sku').eq('master_product_id', productId),
    db.from('cogs_components').select('component_type, description, amount_pence, effective_from, store_id, cost_types(label, in_gross)').eq('master_product_id', productId).order('effective_from'),
    db.from('shipping_rules').select('qty, courier_cost_pence, effective_from, store_id').eq('master_product_id', productId).order('effective_from'),
  ])
  const page = (children: React.ReactNode, p?: { sku: string; name: string }) => (
    <div style={pageStyle}>
      <Heading f={f} product={p} editHref={p ? `/products/${productId}` : undefined} />
      <FilterBar key={`${f.from}|${f.to}`} path={PATH} filters={f} stores={storeOptions} extra={{ product: productId, channel }} />
      {children}
    </div>
  )
  if (!product) return page(<div style={{ ...cardStyle, color: muted }}>That product wasn&apos;t found. Search for it above.</div>)
  if (periods.error || !periods.current) return page(<div style={{ ...cardStyle, color: red }}>Error: {periods.error}</div>)
  const head = { sku: product.standard_sku, name: product.name }

  // Just this product's figures (overheads were shared across the whole business first)
  const mine = { row: (r: { master_product_id: string }) => r.master_product_id === productId, ad: (l: { master_product_id: string }) => l.master_product_id === productId }
  const cur = filterPeriod(periods.current, mine)
  const prev = periods.previous ? filterPeriod(periods.previous, mine) : null
  const all = grandTotals(cur)
  const allM = metrics(all, opts)
  const prevAll = prev ? grandTotals(prev) : null
  const prevM = prevAll ? metrics(prevAll, opts) : null

  const storeKey = { row: (r: { store_id: string }) => r.store_id, ad: (l: { store_id: string }) => l.store_id }
  const byStore = groupTotals(cur, storeKey)
  const prevByStore = prev ? groupTotals(prev, storeKey) : null
  const byListing = groupTotals(cur, { row: (r) => r.platform_listing_id, ad: (l) => l.platform_listing_id })

  // Rows: every store that sold it or lists it, best net profit first (listed, no sales: last)
  const listingRows = (listings || []) as { id: string; store_id: string; platform_sku: string }[]
  const storeIds = [...new Set([...byStore.keys(), ...listingRows.map((l) => l.store_id)])].filter((id) => !f.store || id === f.store)
  const storeOf = (id: string) => stores.find((s) => s.id === id)
  const channelRows = storeIds
    .map((id) => ({ id, name: storeLabel(storeOf(id)), t: byStore.get(id), m: byStore.has(id) ? metrics(byStore.get(id)!, opts) : null }))
    .sort((a, b) => (b.m?.netProfitPence ?? -Infinity) - (a.m?.netProfitPence ?? -Infinity))

  // Best channel: highest net margin among stores that sold it
  const best = channelRows.filter((c) => c.m?.netMarginPercent != null).sort((a, b) => b.m!.netMarginPercent! - a.m!.netMarginPercent!)[0]
  // The one-unit breakdown: the chosen channel, else the one that sold most
  const selected = byStore.has(channel) ? channel : [...byStore].sort((a, b) => b[1].unitsSold - a[1].unitsSold)[0]?.[0] ?? ''

  // Landed cost per unit today: the latest all-stores entry of each landed cost type (+ description)
  const costRows = (costs || []) as unknown as CostRow[]
  const latest = new Map<string, CostRow>()
  for (const c of costRows) if (c.cost_types?.in_gross && !c.store_id && c.effective_from <= today) latest.set(`${c.component_type}|${c.description ?? ''}`, c)
  const landed = [...latest.values()]
  const landedPence = landed.reduce((s, c) => s + c.amount_pence, 0)
  const landedSince = landed.map((c) => c.effective_from).sort().pop()

  const hasData = cur.rows.length > 0 || cur.ads.length > 0
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`)

  // Margin history markers: cost and shipping changes within the 12 months
  const markers = [
    ...costRows.filter((c) => c.effective_from >= trendFrom).map((c) => ({
      date: c.effective_from,
      label: `${c.cost_types?.label ?? c.component_type}${c.description ? ` (${c.description})` : ''} ${pounds(c.amount_pence)}${c.store_id ? ` · ${storeLabel(storeOf(c.store_id))} only` : ''}`,
    })),
    ...((rules || []) as RuleRow[]).filter((r) => r.effective_from >= trendFrom).map((r) => ({
      date: r.effective_from,
      label: `Shipping rule, ${r.qty} unit${r.qty === 1 ? '' : 's'}: ${pounds(r.courier_cost_pence)}${r.store_id ? ` · ${storeLabel(storeOf(r.store_id))} only` : ''}`,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const months = trend.periods.map((p) => {
    const t = grandTotals(filterPeriod(p, mine))
    const m = metrics(t, opts)
    return { month: p.month, margin: m.netMarginPercent, profit: m.netProfitPence, units: t.unitsSold }
  })

  const th = (label: string, left = false): React.ReactNode => <th scope="col" style={{ ...thStyle, textAlign: left ? 'left' : 'right', whiteSpace: 'nowrap' }}>{label}</th>
  const td: CSSProperties = { ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
  const figures = (t: Totals, vatRegistered: boolean | null) => {
    const m = metrics(t, opts)
    const be = vatRegistered === null ? null : breakEvenAcos(t, opts, vatRegistered)
    return (
      <>
        <td style={td}>{t.unitsSold > 0 ? pounds(Math.round(t.saleGrossPence / t.unitsSold)) : '—'}</td>
        <td style={td}>{t.unitsSold.toLocaleString('en-GB')}</td>
        <td style={td}>{wholePounds(t.revenuePence)}</td>
        <td style={td}>{wholePounds(m.grossProfitPence)}</td>
        <td style={td}>{pct(m.grossMarginPercent)}</td>
        <td style={{ ...td, fontWeight: 700, color: m.netProfitPence < 0 ? red : text }}>{wholePounds(m.netProfitPence)}</td>
        <td style={td}><MarginPill value={m.netMarginPercent} ranges={ranges} /></td>
        <td style={td}>{m.profitPerUnitPence === null ? '—' : pounds(m.profitPerUnitPence)}</td>
        <td style={{ ...td, color: m.acosPercent !== null && be !== null && m.acosPercent > be ? red : text }}>{pct(m.acosPercent)}</td>
        <td style={td}>{vatRegistered === null ? '' : pct(be)}</td>
      </>
    )
  }

  return page(
    !hasData ? (
      <div style={{ ...cardStyle, color: muted }}>
        No sales or ad spend for this product from {ukDate(f.from)} to {ukDate(f.to)}. Try a longer date range.
      </div>
    ) : (
      <>
        <p style={{ ...pageIntro, marginTop: '16px' }}>{ukRange(f)} · net profit {profitBasis(f)}, net of refunds.</p>
        <section aria-label="Headline figures" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginTop: '16px' }}>
          <KpiCard label="Net profit" value={wholePounds(allM.netProfitPence)} valueColor={allM.netProfitPence < 0 ? red : text}>
            {f.compare && <Delta current={allM.netProfitPence} previous={prevM?.netProfitPence ?? null} kind="change" />}
          </KpiCard>
          <KpiCard label="Net margin" value={pct(allM.netMarginPercent)}>
            {f.compare && <Delta current={allM.netMarginPercent} previous={prevM?.netMarginPercent ?? null} kind="points" />}
          </KpiCard>
          <KpiCard label="Gross margin" value={pct(allM.grossMarginPercent)}>
            {f.compare && <Delta current={allM.grossMarginPercent} previous={prevM?.grossMarginPercent ?? null} kind="points" />}
          </KpiCard>
          <KpiCard label="Profit per unit" value={allM.profitPerUnitPence === null ? '—' : pounds(allM.profitPerUnitPence)}>
            {f.compare && <Delta current={allM.profitPerUnitPence} previous={prevM?.profitPerUnitPence ?? null} kind="money" />}
            <span style={{ color: muted }}>{all.unitsSold.toLocaleString('en-GB')} units sold</span>
          </KpiCard>
          <KpiCard label="Landed cost / unit" value={landed.length ? pounds(landedPence) : '—'}>
            <span style={{ color: muted }}>{landed.length ? `as entered, since ${ukDate(landedSince)}` : 'No landed cost entered'}</span>
          </KpiCard>
          <KpiCard label="Best channel" value={best ? best.name : '—'}>
            {best && <span><MarginPill value={best.m!.netMarginPercent} ranges={ranges} suffix=" net" /></span>}
          </KpiCard>
        </section>

        <section aria-label="By channel" style={cardStyle}>
          <h2 style={cardTitle}>By channel</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: '980px', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {th('Channel', true)}{th('Avg paid / unit')}{th('Units sold')}{th('Net sales')}{th('Gross profit')}{th('Gross %')}{th('Net profit')}{th('Net %')}{th('Profit / unit')}{th('ACOS')}{th('Break-even ACOS')}
                </tr>
              </thead>
              <tbody>
                {channelRows.map((c) => {
                  const on = c.id === selected
                  const subs = listingRows.filter((l) => l.store_id === c.id && byListing.has(l.id))
                  return [
                    <tr key={c.id} style={{ background: on ? panelRaised : 'transparent' }}>
                      <th scope="row" style={{ ...tdStyle, textAlign: 'left', fontWeight: 700 }}>
                        {c.t
                          ? <Link href={`${dashHref(PATH, f, {}, { product: productId, channel: c.id })}#unit-economics`} style={{ color: on ? lime : text, textDecoration: 'none' }} title="Show one unit's breakdown for this channel">{c.name}</Link>
                          : c.name}
                        {f.compare && c.m && <div style={{ fontSize: '11px', fontWeight: 600 }}><Delta compact current={c.m.netMarginPercent} previous={prevByStore?.get(c.id) ? metrics(prevByStore.get(c.id)!, opts).netMarginPercent : null} kind="points" /></div>}
                      </th>
                      {c.t ? figures(c.t, !!storeOf(c.id)?.vat_registered) : <td colSpan={10} style={{ ...tdStyle, color: dim }}>Listed, no sales in this period</td>}
                    </tr>,
                    // A product with 2+ store SKUs selling in one store (e.g. Amazon resale "amzn.gr."): each one under it
                    ...(subs.length > 1 ? subs.map((l) => (
                      <tr key={l.id}>
                        <th scope="row" style={{ ...tdStyle, textAlign: 'left', fontWeight: 400, color: muted, paddingLeft: '22px' }}>
                          ↳ {l.platform_sku}{l.platform_sku.toLowerCase().startsWith('amzn.gr.') ? ' (resale)' : ''}
                        </th>
                        {figures(byListing.get(l.id)!, !!storeOf(c.id)?.vat_registered)}
                      </tr>
                    )) : []),
                  ]
                })}
                {channelRows.filter((c) => c.t).length > 1 && (
                  <tr style={{ borderTop: `2px solid ${text}` }}>
                    <th scope="row" style={{ ...tdStyle, textAlign: 'left', fontWeight: 800 }}>All channels</th>
                    {figures(all, null)}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '12px', color: dim, margin: '12px 0 0' }}>
            Click a channel for one unit&apos;s breakdown. Avg paid / unit = what customers paid inc. VAT and delivery. Break-even ACOS = the ad spend (as % of sales, like ACOS) that would take this channel&apos;s net profit to £0; ACOS above it shows red.
          </p>
        </section>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'stretch' }}>
          {selected && byStore.get(selected)!.netUnits > 0 ? (
            <MoneyBridge
                id="unit-economics"
                title={`One unit · ${storeLabel(storeOf(selected))}`}
                totals={byStore.get(selected)!}
                perUnit={byStore.get(selected)!.netUnits}
                opts={opts}
                costSplit={cur.costSplit}
                style={{ ...cardStyle, flex: '1 1 460px', minWidth: 0 }}
              >
                <p style={{ fontSize: '13px', color: muted, margin: '-8px 0 14px' }}>
                  Average per unit kept (units sold less refunded) in this period. {storeOf(selected)?.vat_registered ? 'Ex. VAT (VAT registered).' : 'Inc. VAT (not VAT registered).'}
                </p>
              </MoneyBridge>
          ) : null}
          <MarginHistory months={months} markers={markers} ranges={ranges} basis={profitBasis(f)} error={trend.error} />
        </div>
      </>
    ),
    head
  )
}

// Net margin % by month, last 12 months, with a numbered line where a cost or shipping rule changed
function MarginHistory({ months, markers, ranges, basis, error }: {
  months: { month: string; margin: number | null; profit: number; units: number }[]
  markers: { date: string; label: string }[]
  ranges: MarginRanges
  basis: string
  error: string | null
}) {
  const W = 720
  const H = 230
  const L = 44
  const R = 12
  const T = 18
  const B = 26
  const values = months.map((m) => m.margin).filter((v): v is number => v !== null)
  const lo = Math.floor(Math.min(0, ranges.redBelow, ...values) / 10) * 10
  const hi = Math.ceil(Math.max(ranges.greenFrom, ...values, 0) / 10) * 10 || 10
  const x = (i: number) => L + (months.length > 1 ? (i * (W - L - R)) / (months.length - 1) : (W - L - R) / 2)
  const y = (v: number) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B)
  const label = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })

  // The line breaks over months with no sales
  const segments: string[] = []
  let current = ''
  months.forEach((m, i) => {
    if (m.margin === null) {
      if (current) segments.push(current)
      current = ''
    } else current += `${current ? 'L' : 'M'}${x(i).toFixed(1)},${y(m.margin).toFixed(1)}`
  })
  if (current) segments.push(current)
  const markerIndex = (date: string) => months.findIndex((m) => m.month === date.slice(0, 7))
  const shownMarkers = markers.filter((mk) => markerIndex(mk.date) >= 0)

  return (
    <section aria-label="Margin history" style={{ ...cardStyle, flex: '1 1 460px', minWidth: 0 }}>
      <h2 style={cardTitle}>Net margin · last 12 months</h2>
      <p style={{ fontSize: '13px', color: muted, margin: '-8px 0 10px' }}>{basis}. Dashed lines: your red / green cut-offs. Numbered lines: cost changes.</p>
      {error ? <p style={{ color: red }}>Error: {error}</p> : values.length === 0 ? <p style={{ color: muted }}>No sales in the last 12 months.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Monthly net margin: ${months.map((m) => `${label(m.month)} ${m.margin === null ? 'no sales' : `${m.margin}%`}`).join(', ')}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          {/* £0 line, then the tenant's red / green cut-offs */}
          <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke={border} strokeWidth={1} />
          <text x={L - 6} y={y(0) + 4} fill={muted} fontSize={11} textAnchor="end">0%</text>
          {[ranges.redBelow, ranges.greenFrom].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={dim} strokeWidth={1} strokeDasharray="4 4" />
              <text x={L - 6} y={y(v) + 4} fill={muted} fontSize={11} textAnchor="end">{v}%</text>
            </g>
          ))}
          <text x={L - 6} y={y(hi) + 4} fill={muted} fontSize={11} textAnchor="end">{hi}%</text>
          {lo < 0 && <text x={L - 6} y={y(lo) + 4} fill={muted} fontSize={11} textAnchor="end">{lo}%</text>}
          {shownMarkers.map((mk, n) => {
            const i = markerIndex(mk.date)
            return (
              <g key={`${mk.date}${n}`}>
                <line x1={x(i)} x2={x(i)} y1={T - 4} y2={H - B} stroke={muted} strokeWidth={1} strokeDasharray="2 3" />
                <text x={x(i) + 3} y={T - 6} fill={text} fontSize={11} fontWeight={700}>{n + 1}</text>
                <title>{`${ukDate(mk.date)}: ${mk.label}`}</title>
              </g>
            )
          })}
          {segments.map((d) => <path key={d} d={d} fill="none" stroke={chartProfit} strokeWidth={2} strokeLinejoin="round" />)}
          {months.map((m, i) => (
            <g key={m.month}>
              {m.margin !== null && (
                <circle cx={x(i)} cy={y(m.margin)} r={4} fill={chartProfit} stroke={cardStyle.background as string} strokeWidth={2}>
                  <title>{`${label(m.month)}: ${m.margin}% net margin · ${wholePounds(m.profit)} · ${m.units} sold`}</title>
                </circle>
              )}
              <text x={x(i)} y={H - 8} fill={muted} fontSize={11} textAnchor="middle">{label(m.month)}</text>
            </g>
          ))}
        </svg>
      )}
      {shownMarkers.length > 0 && (
        <ol style={{ margin: '10px 0 0', paddingLeft: '20px', fontSize: '12px', color: muted, lineHeight: 1.6 }}>
          {shownMarkers.map((mk, n) => <li key={`${mk.date}${n}`}>{ukDate(mk.date)} · {mk.label}</li>)}
        </ol>
      )}
    </section>
  )
}
