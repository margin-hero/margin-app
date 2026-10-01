'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { useMarginRanges } from '@/hooks/useMarginRanges'
import { marginTier, red, green, muted, dim, text, lime, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, thStyle, tdStyle } from '@/lib/theme'
import { pounds, percent } from '@/lib/format'
import DateRangeBar from '@/components/DateRangeBar'

type MarginRow = {
  master_product_id: string
  product_name: string
  channel: string
  order_date: string
  effective_qty: number
  revenue_pence: number
  product_cost_pence: number
  total_cost_pence: number
  margin_pence: number
}

type ChannelStats = {
  channel: string
  totalSalesPence: number
  totalQty: number
  grossProfitPence: number
  netProfitPence: number
  grossMarginPercent: number | null
  netMarginPercent: number | null
  profitPerUnitPence: number | null
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
        .from('order_margins')
        .select('master_product_id, product_name, channel, order_date, effective_qty, revenue_pence, product_cost_pence, total_cost_pence, margin_pence')
        .gte('order_date', dateFrom)
        .lte('order_date', dateTo)
        .order('order_line_item_id')
        .range(from, to)
    )

    const { data: products } = await fetchAll((from, to) =>
      supabase.from('master_products').select('id, standard_sku').order('id').range(from, to)
    )

    const skuMap = new Map((products || []).map((p) => [p.id, p.standard_sku]))

    const byProductChannel = new Map<string, MarginRow[]>()
    for (const row of (rows || []) as MarginRow[]) {
      const key = `${row.master_product_id}|${row.channel}`
      if (!byProductChannel.has(key)) byProductChannel.set(key, [])
      byProductChannel.get(key)!.push(row)
    }

    const byProduct = new Map<string, ProductGroup>()

    for (const [key, groupRows] of byProductChannel) {
      const first = groupRows[0]
      const totalRevenue = groupRows.reduce((s, r) => s + r.revenue_pence, 0)
      const totalProductCost = groupRows.reduce((s, r) => s + r.product_cost_pence, 0)
      const totalNetProfit = groupRows.reduce((s, r) => s + r.margin_pence, 0)
      const totalQty = groupRows.reduce((s, r) => s + r.effective_qty, 0)
      const grossProfit = totalRevenue - totalProductCost

      const channelStats: ChannelStats = {
        channel: first.channel,
        totalSalesPence: totalRevenue,
        totalQty,
        grossProfitPence: grossProfit,
        netProfitPence: totalNetProfit,
        grossMarginPercent: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : null,
        netMarginPercent: totalRevenue > 0 ? Math.round((totalNetProfit / totalRevenue) * 1000) / 10 : null,
        profitPerUnitPence: totalQty > 0 ? Math.round(totalNetProfit / totalQty) : null,
      }

      if (!byProduct.has(first.master_product_id)) {
        byProduct.set(first.master_product_id, {
          masterProductId: first.master_product_id,
          productName: first.product_name,
          standardSku: skuMap.get(first.master_product_id) || '',
          channels: [],
        })
      }
      byProduct.get(first.master_product_id)!.channels.push(channelStats)
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

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Dashboards</p>
      <h1 style={pageTitle}>SKU Detail</h1>
      <p style={pageIntro}>Gross vs net profit for every product, store by store.</p>

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
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '760px' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Store</th>
                    <th style={numHead}>Gross margin</th>
                    <th style={numHead}>Net margin</th>
                    <th style={numHead}>Gross profit</th>
                    <th style={numHead}>Net profit</th>
                    <th style={numHead}>Profit / unit</th>
                    <th style={numHead}>Units</th>
                    <th style={numHead}>Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {group.channels.map((c) => (
                    <tr key={c.channel}>
                      <td style={tdStyle}>{c.channel}</td>
                      <td style={{ ...num, color: marginColor(c.grossMarginPercent) }}>{percent(c.grossMarginPercent)}</td>
                      <td style={{ ...num, color: marginColor(c.netMarginPercent) }}>{percent(c.netMarginPercent)}</td>
                      <td style={num}>{pounds(c.grossProfitPence)}</td>
                      <td style={{ ...num, color: c.netProfitPence < 0 ? red : green }}>{pounds(c.netProfitPence)}</td>
                      <td style={{ ...num, color: c.profitPerUnitPence === null ? dim : text }}>{c.profitPerUnitPence !== null ? pounds(c.profitPerUnitPence) : '—'}</td>
                      <td style={num}>{c.totalQty}</td>
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
