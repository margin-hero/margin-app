'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadMarginSummary, type SummaryRow } from '@/lib/marginSummary'
import { loadStores } from '@/lib/stores'
import { useMarginRanges } from '@/hooks/useMarginRanges'
import { marginTier, red, green, muted, dim, text, lime, border, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, thStyle, tdStyle, inputStyle } from '@/lib/theme'
import { pounds, percent } from '@/lib/format'
import DateRangeBar from '@/components/DateRangeBar'
import { loadAdSpend, sumAdSpend, acosPercent, tacosPercent, AdTotals } from '@/lib/adSpend'

type ChannelStats = {
  key: string
  channel: string // the store's name, e.g. "Ark Rubber Ltd", or the store SKU on a sub-row
  platform?: string // e.g. "B&Q" (store rows only)
  resale?: boolean // an Amazon Grade & Resell store SKU (amzn.gr.)
  grossSalesPence: number // what customers paid, inc. VAT and delivery
  totalSalesPence: number // net sales
  orderCount: number
  totalQty: number // units sold
  aovPence: number | null
  refundsPence: number // what customers got back, inc. VAT and delivery (like gross sales)
  refundedUnits: number
  refundRatePercent: number | null // refunded units ÷ units sold
  grossProfitPence: number
  netProfitPence: number
  grossMarginPercent: number | null
  netMarginPercent: number | null
  profitPerUnitPence: number | null
  adCostPence: number
  acosPercent: number | null
  tacosPercent: number | null
  netAfterAdsPence: number
  netAfterAdsPercent: number | null
  // When the product has 2+ store SKUs selling in this store: each one's own figures
  storeSkus: ChannelStats[]
}

// The figures for a set of sale / refund rows (and their ad spend). Totals first, then the
// percentages from the totals, never averaged.
function stats(key: string, label: string, rows: SummaryRow[], ads: AdTotals | undefined): ChannelStats {
  const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue_pence), 0)
  const totalProductCost = rows.reduce((s, r) => s + Number(r.product_cost_pence), 0)
  const totalNetProfit = rows.reduce((s, r) => s + Number(r.margin_pence), 0)
  const sales = rows.filter((r) => r.line_type === 'sale')
  const totalQty = sales.reduce((s, r) => s + r.effective_qty, 0)
  const orderCount = sales.reduce((s, r) => s + r.lines, 0)
  const salesRevenue = sales.reduce((s, r) => s + Number(r.revenue_pence), 0)
  const grossSales = rows.reduce((s, r) => s + Number(r.gross_sales_pence), 0)
  const refundedUnits = rows.reduce((s, r) => s + r.refunded_units, 0)
  const keptUnits = totalQty - refundedUnits // profit per unit is per unit the customer kept
  const grossProfit = totalRevenue - totalProductCost
  const adCost = ads?.costPence ?? 0
  const netAfterAds = totalNetProfit - adCost
  return {
    key,
    channel: label,
    grossSalesPence: grossSales,
    totalSalesPence: totalRevenue,
    orderCount,
    totalQty,
    aovPence: orderCount > 0 ? Math.round(salesRevenue / orderCount) : null,
    refundsPence: rows.filter((r) => r.line_type === 'refund').reduce((s, r) => s - Number(r.gross_sales_pence), 0),
    refundedUnits,
    refundRatePercent: totalQty > 0 ? Math.round((refundedUnits / totalQty) * 1000) / 10 : null,
    grossProfitPence: grossProfit,
    netProfitPence: totalNetProfit,
    grossMarginPercent: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : null,
    netMarginPercent: totalRevenue > 0 ? Math.round((totalNetProfit / totalRevenue) * 1000) / 10 : null,
    profitPerUnitPence: keptUnits > 0 ? Math.round(totalNetProfit / keptUnits) : null,
    adCostPence: adCost,
    acosPercent: acosPercent(ads),
    tacosPercent: tacosPercent(ads, grossSales),
    netAfterAdsPence: netAfterAds,
    netAfterAdsPercent: totalRevenue > 0 ? Math.round((netAfterAds / totalRevenue) * 1000) / 10 : null,
    storeSkus: [],
  }
}

type ProductGroup = {
  masterProductId: string
  productName: string
  standardSku: string
  channels: ChannelStats[]
  total: ChannelStats // all stores together: what the products are sorted by
}

// How products (and the stores within each product) can be ordered. Percentages with no
// sales (null) always go last.
const SORTS = {
  net: { label: 'Net profit (high to low)', compare: (a: ChannelStats, b: ChannelStats) => b.netProfitPence - a.netProfitPence },
  gross: { label: 'Gross sales (high to low)', compare: (a: ChannelStats, b: ChannelStats) => b.grossSalesPence - a.grossSalesPence },
  netSales: { label: 'Net sales (high to low)', compare: (a: ChannelStats, b: ChannelStats) => b.totalSalesPence - a.totalSalesPence },
  margin: { label: 'Net margin % (high to low)', compare: (a: ChannelStats, b: ChannelStats) => (b.netMarginPercent ?? -Infinity) - (a.netMarginPercent ?? -Infinity) },
  marginLow: { label: 'Net margin % (low to high)', compare: (a: ChannelStats, b: ChannelStats) => (a.netMarginPercent ?? Infinity) - (b.netMarginPercent ?? Infinity) },
  units: { label: 'Units sold (high to low)', compare: (a: ChannelStats, b: ChannelStats) => b.totalQty - a.totalQty },
  refunds: { label: 'Refund rate (high to low)', compare: (a: ChannelStats, b: ChannelStats) => (b.refundRatePercent ?? -Infinity) - (a.refundRatePercent ?? -Infinity) },
  ads: { label: 'Ad spend (high to low)', compare: (a: ChannelStats, b: ChannelStats) => b.adCostPence - a.adCostPence },
} as const
type SortKey = keyof typeof SORTS | 'sku'
const SORT_LABELS: [SortKey, string][] = [...(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((k): [SortKey, string] => [k, SORTS[k].label]), ['sku', 'SKU A–Z']]
const SORT_STORAGE_KEY = 'mh-sku-detail-sort'

function defaultFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 29) // last 30 days including today
  return d.toISOString().slice(0, 10)
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10)
}

export default function SkuDetailPage() {
  const ranges = useMarginRanges()
  const [rangeFrom, setRangeFrom] = useState(defaultFrom())
  const [rangeTo, setRangeTo] = useState(defaultTo())
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('net')

  async function load(dateFrom: string = rangeFrom, dateTo: string = rangeTo) {
    setLoading(true)

    // Sales and refunds (negative), added up in the database per product × store SKU × month
    const { data: rows } = await loadMarginSummary({ from: dateFrom, to: dateTo })

    const { data: products } = await fetchAll((from, to) =>
      supabase.from('master_products').select('id, standard_sku').order('id').range(from, to)
    )

    const { data: listings } = await fetchAll((from, to) =>
      supabase.from('platform_listings').select('id, platform_sku').order('id').range(from, to)
    )

    const skuMap = new Map((products || []).map((p) => [p.id, p.standard_sku]))
    const storeSkuOf = new Map((listings || []).map((l) => [l.id as string, l.platform_sku as string]))
    const storeById = new Map((await loadStores()).map((st) => [st.id, st]))
    const adLines = await loadAdSpend({ from: dateFrom, to: dateTo })
    const adsByKey = sumAdSpend(adLines, (l) => `${l.master_product_id}|${l.store_id}`)
    const adsByProduct = sumAdSpend(adLines, (l) => l.master_product_id)
    const adsByStoreSku = sumAdSpend(adLines, (l) => `${l.master_product_id}|${l.store_id}|${l.platform_listing_id}`)
    const adProductNames = new Map(adLines.map((l) => [l.master_product_id, l.product_name]))

    const byProductChannel = new Map<string, SummaryRow[]>()
    for (const row of rows) {
      // By store, not store name: two stores can share a name on different platforms
      const key = `${row.master_product_id}|${row.store_id}`
      if (!byProductChannel.has(key)) byProductChannel.set(key, [])
      byProductChannel.get(key)!.push(row)
    }
    // A product with ad spend in a store but no sales there in the period still gets a row
    for (const key of adsByKey.keys()) if (!byProductChannel.has(key)) byProductChannel.set(key, [])

    const byProduct = new Map<string, ProductGroup>()

    for (const [key, groupRows] of byProductChannel) {
      const [productId, storeId] = key.split('|')
      const store = storeById.get(storeId)
      const channelStats = stats(key, store?.name ?? groupRows[0]?.channel ?? '?', groupRows, adsByKey.get(key))
      channelStats.platform = store?.platforms?.name ?? ''

      // Each store SKU's own figures, when the product has more than one in this store
      // (e.g. an Amazon resale SKU next to the FBA one, or the same item listed twice)
      const rowsBySku = new Map<string, SummaryRow[]>()
      for (const r of groupRows) {
        if (!rowsBySku.has(r.platform_listing_id)) rowsBySku.set(r.platform_listing_id, [])
        rowsBySku.get(r.platform_listing_id)!.push(r)
      }
      for (const adKey of adsByStoreSku.keys()) {
        const [p, st, listingId] = adKey.split('|')
        if (p === productId && st === storeId && !rowsBySku.has(listingId)) rowsBySku.set(listingId, [])
      }
      if (rowsBySku.size > 1) {
        channelStats.storeSkus = Array.from(rowsBySku, ([listingId, skuRows]) => {
          const storeSku = storeSkuOf.get(listingId) ?? '?'
          return { ...stats(`${key}|${listingId}`, storeSku, skuRows, adsByStoreSku.get(`${key}|${listingId}`)), resale: /^amzn\.gr\./i.test(storeSku) }
        }).sort((a, b) => b.totalSalesPence - a.totalSalesPence)
      }

      if (!byProduct.has(productId)) {
        byProduct.set(productId, {
          masterProductId: productId,
          productName: groupRows[0]?.product_name ?? adProductNames.get(productId) ?? '?',
          standardSku: skuMap.get(productId) || '',
          channels: [],
          total: stats(productId, 'All stores', (rows || []).filter((r) => r.master_product_id === productId), adsByProduct.get(productId)),
        })
      }
      byProduct.get(productId)!.channels.push(channelStats)
    }

    setGroups(Array.from(byProduct.values()))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const num: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontWeight: 700 }
  const numHead: React.CSSProperties = { ...thStyle, textAlign: 'right' }

  function marginColor(pct: number | null) {
    return marginTier(pct, ranges).fg
  }

  // Remember the chosen order in this browser
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_STORAGE_KEY)
      if (saved && (saved === 'sku' || saved in SORTS)) setSortBy(saved as SortKey)
    } catch {}
  }, [])
  function changeSort(key: SortKey) {
    setSortBy(key)
    try {
      localStorage.setItem(SORT_STORAGE_KEY, key)
    } catch {}
  }

  // Search: SKU or product name containing the text (any case)
  const needle = search.trim().toLowerCase()
  const shown = groups
    .filter((g) => !needle || g.standardSku.toLowerCase().includes(needle) || g.productName.toLowerCase().includes(needle))
    .sort((a, b) => (sortBy === 'sku' ? 0 : SORTS[sortBy].compare(a.total, b.total)) || a.standardSku.localeCompare(b.standardSku) || a.productName.localeCompare(b.productName))
  // Stores within a product follow the same order (by net sales when sorting by SKU)
  const storeOrder = (a: ChannelStats, b: ChannelStats) => SORTS[sortBy === 'sku' ? 'netSales' : sortBy].compare(a, b) || a.channel.localeCompare(b.channel)

  // The ad columns only appear once there's ad spend in the period
  const hasAds = groups.some((g) => g.channels.some((c) => c.adCostPence > 0))

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Dashboards</p>
      <h1 style={pageTitle}>SKU Detail</h1>
      <p style={pageIntro}>Gross vs net profit for every product, store by store (and store SKU by store SKU, ↳, where a product has more than one in a store, e.g. an Amazon resale SKU). Refunds are taken off in the period they happened; Refunds shows what customers got back (inc. VAT and delivery), then units refunded and the refund rate (refunded units ÷ units sold). Once ad spend is imported, Net after ads takes it off (ACOS = ad spend ÷ ad sales, TACOS = ad spend ÷ all gross sales).</p>

      <DateRangeBar
        from={rangeFrom}
        to={rangeTo}
        onChange={(f, t) => { setRangeFrom(f); setRangeTo(t) }}
        onApply={(f, t) => load(f, t)}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU or product" aria-label="Search SKU or product" style={{ ...inputStyle, width: '240px', maxWidth: '100%' }} />
        <label htmlFor="sku-sort" style={{ fontSize: '13px', color: muted, marginLeft: '6px' }}>Sort by</label>
        <select id="sku-sort" value={sortBy} onChange={(e) => changeSort(e.target.value as SortKey)} style={inputStyle}>
          {SORT_LABELS.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        {!loading && groups.length > 0 && (
          <span style={{ fontSize: '12px', color: muted }}>
            {needle ? `${shown.length} of ${groups.length} products match` : `${groups.length} products`}
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ color: muted, marginTop: '20px' }}>Loading...</p>
      ) : groups.length === 0 ? (
        <div style={cardStyle}><p style={{ color: muted, margin: 0 }}>No orders in this date range.</p></div>
      ) : shown.length === 0 ? (
        <div style={cardStyle}><p style={{ color: muted, margin: 0 }}>No products match &ldquo;{search.trim()}&rdquo;.</p></div>
      ) : (
        shown.map((group) => (
          <div key={group.masterProductId} style={cardStyle}>
            <p style={{ margin: '0 0 12px', fontSize: '16px' }}>
              <span style={{ color: lime, fontWeight: 800 }}>{group.standardSku}</span>{' '}
              <span style={{ color: muted }}>{group.productName}</span>
            </p>
            <div style={{ overflowX: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${border} transparent` }}>
              {/* Columns in the same order as the Channel Overview cards */}
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: hasAds ? '1760px' : '1360px' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Channel</th>
                    <th style={thStyle}>Store</th>
                    <th style={numHead}>Gross sales</th>
                    <th style={numHead}>Net sales</th>
                    <th style={numHead}>Gross margin</th>
                    <th style={numHead}>Net margin</th>
                    <th style={numHead}>Gross profit</th>
                    <th style={numHead}>Net profit</th>
                    <th style={numHead}>Profit / unit</th>
                    <th style={numHead}>Orders</th>
                    <th style={numHead}>Units</th>
                    <th style={numHead}>Avg order value</th>
                    <th style={numHead}>Refunds</th>
                    <th style={numHead}>Refunded units</th>
                    <th style={numHead}>Refund rate</th>
                    {hasAds && <th style={numHead}>Ad spend</th>}
                    {hasAds && <th style={numHead}>ACOS</th>}
                    {hasAds && <th style={numHead}>TACOS</th>}
                    {hasAds && <th style={numHead}>Net after ads</th>}
                  </tr>
                </thead>
                <tbody>
                  {[...group.channels].sort(storeOrder).flatMap((c) => [c, ...c.storeSkus]).map((c) => {
                    const sub = c.key.split('|').length > 2 // a store SKU under its store
                    return (
                    <tr key={c.key}>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{sub ? '' : c.platform}</td>
                      <td style={sub ? { ...tdStyle, paddingLeft: '28px', color: muted, fontSize: '13px' } : tdStyle}>
                        {sub ? `↳ ${c.channel}` : c.channel}
                        {c.resale && <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 700, color: text, border: `1px solid ${dim}`, borderRadius: '6px', padding: '1px 6px' }}>resale</span>}
                      </td>
                      <td style={num}>{pounds(c.grossSalesPence)}</td>
                      <td style={num}>{pounds(c.totalSalesPence)}</td>
                      <td style={{ ...num, color: marginColor(c.grossMarginPercent) }}>{percent(c.grossMarginPercent)}</td>
                      <td style={{ ...num, color: marginColor(c.netMarginPercent) }}>{percent(c.netMarginPercent)}</td>
                      <td style={num}>{pounds(c.grossProfitPence)}</td>
                      <td style={{ ...num, color: c.netProfitPence < 0 ? red : green }}>{pounds(c.netProfitPence)}</td>
                      <td style={{ ...num, color: c.profitPerUnitPence === null ? dim : text }}>{c.profitPerUnitPence !== null ? pounds(c.profitPerUnitPence) : '—'}</td>
                      <td style={num}>{c.orderCount.toLocaleString('en-GB')}</td>
                      <td style={num}>{c.totalQty.toLocaleString('en-GB')}</td>
                      <td style={{ ...num, color: c.aovPence === null ? dim : text }}>{c.aovPence !== null ? pounds(c.aovPence) : '—'}</td>
                      <td style={{ ...num, color: c.refundsPence > 0 ? text : dim }}>{c.refundsPence > 0 ? pounds(-c.refundsPence) : '—'}</td>
                      <td style={{ ...num, color: c.refundedUnits > 0 ? text : dim }}>{c.refundedUnits > 0 ? c.refundedUnits.toLocaleString('en-GB') : '—'}</td>
                      <td style={{ ...num, color: c.refundedUnits > 0 ? text : dim }}>{c.refundedUnits > 0 ? percent(c.refundRatePercent) : '—'}</td>
                      {hasAds && <td style={{ ...num, color: c.adCostPence > 0 ? text : dim }}>{c.adCostPence > 0 ? pounds(-c.adCostPence) : '—'}</td>}
                      {hasAds && <td style={{ ...num, color: c.adCostPence > 0 ? text : dim }}>{c.adCostPence > 0 ? percent(c.acosPercent) : '—'}</td>}
                      {hasAds && <td style={{ ...num, color: c.adCostPence > 0 ? text : dim }}>{c.adCostPence > 0 ? percent(c.tacosPercent) : '—'}</td>}
                      {hasAds && (
                        <td style={{ ...num, color: marginColor(c.netAfterAdsPercent) }}>
                          {pounds(c.netAfterAdsPence)}{c.netAfterAdsPercent !== null ? ` · ${c.netAfterAdsPercent}%` : ''}
                        </td>
                      )}
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
