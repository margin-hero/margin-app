'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadStores, storeLabel } from '@/lib/stores'
import { useMarginRanges } from '@/hooks/useMarginRanges'
import { marginTier, red, green, muted, dim, text, lime, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, thStyle, tdStyle } from '@/lib/theme'
import { pounds, percent } from '@/lib/format'
import DateRangeBar from '@/components/DateRangeBar'
import { loadAdSpend, sumAdSpend, acosPercent, tacosPercent } from '@/lib/adSpend'

type MarginRow = {
  master_product_id: string
  product_name: string
  channel: string
  store_id: string
  order_date: string
  effective_qty: number
  revenue_pence: number
  product_cost_pence: number
  total_cost_pence: number
  margin_pence: number
  line_type: string // 'sale' | 'refund' (refund rows are negative)
  refunded_units: number
  gross_sales_pence: number
}

type ChannelStats = {
  storeId: string
  channel: string // store label, e.g. "Ark Rubber Ltd (B&Q)"
  totalSalesPence: number
  totalQty: number // units sold
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
}

type ProductGroup = {
  masterProductId: string
  productName: string
  standardSku: string
  channels: ChannelStats[]
}

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

  async function load(dateFrom: string = rangeFrom, dateTo: string = rangeTo) {
    setLoading(true)

    const { data: rows } = await fetchAll((from, to) =>
      supabase
        .from('margin_lines') // sales and refunds (negative rows), so figures are net of refunds
        .select('master_product_id, product_name, channel, store_id, order_date, effective_qty, revenue_pence, product_cost_pence, total_cost_pence, margin_pence, line_type, refunded_units, gross_sales_pence')
        .gte('order_date', dateFrom)
        .lte('order_date', dateTo)
        .order('order_line_item_id')
        .range(from, to)
    )

    const { data: products } = await fetchAll((from, to) =>
      supabase.from('master_products').select('id, standard_sku').order('id').range(from, to)
    )

    const skuMap = new Map((products || []).map((p) => [p.id, p.standard_sku]))
    const storeById = new Map((await loadStores()).map((st) => [st.id, st]))
    const adLines = await loadAdSpend({ from: dateFrom, to: dateTo })
    const adsByKey = sumAdSpend(adLines, (l) => `${l.master_product_id}|${l.store_id}`)
    const adProductNames = new Map(adLines.map((l) => [l.master_product_id, l.product_name]))

    const byProductChannel = new Map<string, MarginRow[]>()
    for (const row of (rows || []) as MarginRow[]) {
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
      const totalRevenue = groupRows.reduce((s, r) => s + Number(r.revenue_pence), 0)
      const totalProductCost = groupRows.reduce((s, r) => s + Number(r.product_cost_pence), 0)
      const totalNetProfit = groupRows.reduce((s, r) => s + Number(r.margin_pence), 0)
      const totalQty = groupRows.filter((r) => r.line_type === 'sale').reduce((s, r) => s + r.effective_qty, 0)
      const refundedUnits = groupRows.reduce((s, r) => s + r.refunded_units, 0)
      const keptUnits = totalQty - refundedUnits // profit per unit is per unit the customer kept
      const grossProfit = totalRevenue - totalProductCost
      const ads = adsByKey.get(key)
      const adCost = ads?.costPence ?? 0
      const netAfterAds = totalNetProfit - adCost

      const channelStats: ChannelStats = {
        storeId,
        channel: storeById.has(storeId) ? storeLabel(storeById.get(storeId)) : groupRows[0]?.channel ?? '?',
        totalSalesPence: totalRevenue,
        totalQty,
        refundedUnits,
        refundRatePercent: totalQty > 0 ? Math.round((refundedUnits / totalQty) * 1000) / 10 : null,
        grossProfitPence: grossProfit,
        netProfitPence: totalNetProfit,
        grossMarginPercent: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : null,
        netMarginPercent: totalRevenue > 0 ? Math.round((totalNetProfit / totalRevenue) * 1000) / 10 : null,
        profitPerUnitPence: keptUnits > 0 ? Math.round(totalNetProfit / keptUnits) : null,
        adCostPence: adCost,
        acosPercent: acosPercent(ads),
        tacosPercent: tacosPercent(ads, groupRows.reduce((s, r) => s + Number(r.gross_sales_pence), 0)),
        netAfterAdsPence: netAfterAds,
        netAfterAdsPercent: totalRevenue > 0 ? Math.round((netAfterAds / totalRevenue) * 1000) / 10 : null,
      }

      if (!byProduct.has(productId)) {
        byProduct.set(productId, {
          masterProductId: productId,
          productName: groupRows[0]?.product_name ?? adProductNames.get(productId) ?? '?',
          standardSku: skuMap.get(productId) || '',
          channels: [],
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

  // The ad columns only appear once there's ad spend in the period
  const hasAds = groups.some((g) => g.channels.some((c) => c.adCostPence > 0))

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Dashboards</p>
      <h1 style={pageTitle}>SKU Detail</h1>
      <p style={pageIntro}>Gross vs net profit for every product, store by store. Refunds are taken off in the period they happened; Refunds shows units refunded and the refund rate (refunded units ÷ units sold). Once ad spend is imported, Net after ads takes it off (ACOS = ad spend ÷ ad sales, TACOS = ad spend ÷ all gross sales).</p>

      <DateRangeBar
        from={rangeFrom}
        to={rangeTo}
        onChange={(f, t) => { setRangeFrom(f); setRangeTo(t) }}
        onApply={(f, t) => load(f, t)}
      />

      {loading ? (
        <p style={{ color: muted, marginTop: '20px' }}>Loading...</p>
      ) : groups.length === 0 ? (
        <div style={cardStyle}><p style={{ color: muted, margin: 0 }}>No orders in this date range.</p></div>
      ) : (
        groups.map((group) => (
          <div key={group.masterProductId} style={cardStyle}>
            <p style={{ margin: '0 0 12px', fontSize: '16px' }}>
              <span style={{ color: lime, fontWeight: 800 }}>{group.standardSku}</span>{' '}
              <span style={{ color: muted }}>{group.productName}</span>
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: hasAds ? '1180px' : '840px' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Store</th>
                    <th style={numHead}>Gross margin</th>
                    <th style={numHead}>Net margin</th>
                    <th style={numHead}>Gross profit</th>
                    <th style={numHead}>Net profit</th>
                    {hasAds && <th style={numHead}>Ad spend</th>}
                    {hasAds && <th style={numHead}>ACOS · TACOS</th>}
                    {hasAds && <th style={numHead}>Net after ads</th>}
                    <th style={numHead}>Profit / unit</th>
                    <th style={numHead}>Units</th>
                    <th style={numHead}>Refunds</th>
                    <th style={numHead}>Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {group.channels.map((c) => (
                    <tr key={c.storeId}>
                      <td style={tdStyle}>{c.channel}</td>
                      <td style={{ ...num, color: marginColor(c.grossMarginPercent) }}>{percent(c.grossMarginPercent)}</td>
                      <td style={{ ...num, color: marginColor(c.netMarginPercent) }}>{percent(c.netMarginPercent)}</td>
                      <td style={num}>{pounds(c.grossProfitPence)}</td>
                      <td style={{ ...num, color: c.netProfitPence < 0 ? red : green }}>{pounds(c.netProfitPence)}</td>
                      {hasAds && <td style={{ ...num, color: c.adCostPence > 0 ? text : dim }}>{c.adCostPence > 0 ? pounds(-c.adCostPence) : '—'}</td>}
                      {hasAds && <td style={{ ...num, color: c.adCostPence > 0 ? text : dim }}>{c.adCostPence > 0 ? `${percent(c.acosPercent)} · ${percent(c.tacosPercent)}` : '—'}</td>}
                      {hasAds && (
                        <td style={{ ...num, color: marginColor(c.netAfterAdsPercent) }}>
                          {pounds(c.netAfterAdsPence)}{c.netAfterAdsPercent !== null ? ` · ${c.netAfterAdsPercent}%` : ''}
                        </td>
                      )}
                      <td style={{ ...num, color: c.profitPerUnitPence === null ? dim : text }}>{c.profitPerUnitPence !== null ? pounds(c.profitPerUnitPence) : '—'}</td>
                      <td style={num}>{c.totalQty}</td>
                      <td style={{ ...num, color: c.refundedUnits > 0 ? text : dim }}>
                        {c.refundedUnits > 0 ? `${c.refundedUnits} · ${percent(c.refundRatePercent)}` : '—'}
                      </td>
                      <td style={num}>{pounds(c.totalSalesPence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
