'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Nav from '@/components/Nav'

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
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10)
}

export default function SkuDetailPage() {
  const [dateFrom, setDateFrom] = useState(defaultFrom())
  const [dateTo, setDateTo] = useState(defaultTo())
  const [groups, setGroups] = useState<ProductGroup[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)

    const { data: rows } = await supabase
      .from('order_margins')
      .select('master_product_id, product_name, channel, order_date, effective_qty, revenue_pence, product_cost_pence, total_cost_pence, margin_pence')
      .gte('order_date', dateFrom)
      .lte('order_date', dateTo)

    const { data: products } = await supabase
      .from('master_products')
      .select('id, standard_sku')

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

  const pageStyle: React.CSSProperties = { background: '#1A1A1A', minHeight: '100vh', color: '#fff', fontFamily: 'sans-serif' }
  const cardStyle: React.CSSProperties = { background: '#232323', borderRadius: '12px', border: '0.5px solid #333', padding: '18px', marginTop: '14px' }
  const thStyle: React.CSSProperties = { padding: '6px 10px', textAlign: 'right', color: '#888', fontWeight: 500, fontSize: '12px' }
  const tdNum = (color?: string): React.CSSProperties => ({ padding: '8px 10px', textAlign: 'right', fontWeight: 500, fontSize: '13px', color: color || '#eee' })

  function marginColor(pct: number | null) {
    if (pct === null) return '#555'
    if (pct < 10) return '#FF4C4C'
    if (pct < 20) return '#DCFF00'
    return '#39FF6A'
  }

  return (
    <div style={pageStyle}>
      <Nav />
      <div style={{ padding: '2rem' }}>
        <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '4px' }}>SKU × channel detail</p>
        <h1 style={{ margin: '0 0 16px', fontSize: '22px' }}>Gross vs Net profit, by SKU and channel</h1>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>From</div>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              style={{ padding: '6px', background: '#232323', border: '0.5px solid #444', color: '#fff', borderRadius: '6px' }} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>To</div>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              style={{ padding: '6px', background: '#232323', border: '0.5px solid #444', color: '#fff', borderRadius: '6px' }} />
          </div>
          <button onClick={load} style={{ background: '#DCFF00', color: '#1a1a1a', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 500, cursor: 'pointer' }}>
            Update
          </button>
        </div>

        {loading ? (
          <p style={{ marginTop: '2rem', color: '#888' }}>Loading...</p>
        ) : groups.length === 0 ? (
          <p style={{ marginTop: '2rem', color: '#888' }}>No orders in this date range.</p>
        ) : (
          groups.map((group) => (
            <div key={group.masterProductId} style={cardStyle}>
              <p style={{ margin: '0 0 10px', fontSize: '15px' }}>
                <span style={{ color: '#DCFF00', fontWeight: 500 }}>{group.standardSku}</span>{' '}
                <span style={{ color: '#aaa' }}>{group.productName}</span>
              </p>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid #333' }}>
                    <th style={{ ...thStyle, textAlign: 'left' }}>Channel</th>
                    <th style={thStyle}>Gross Margin %</th>
                    <th style={thStyle}>Net Margin %</th>
                    <th style={thStyle}>Gross Profit</th>
                    <th style={thStyle}>Net Profit</th>
                    <th style={thStyle}>Profit/Unit</th>
                    <th style={thStyle}>Qty Sold</th>
                    <th style={thStyle}>Total Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {group.channels.map((c) => (
                    <tr key={c.channel} style={{ borderBottom: '0.5px solid #2a2a2a' }}>
                      <td style={{ padding: '8px 10px', fontSize: '13px', color: '#eee' }}>{c.channel}</td>
                      <td style={tdNum(marginColor(c.grossMarginPercent))}>{c.grossMarginPercent !== null ? `${c.grossMarginPercent}%` : '—'}</td>
                      <td style={tdNum(marginColor(c.netMarginPercent))}>{c.netMarginPercent !== null ? `${c.netMarginPercent}%` : '—'}</td>
                      <td style={tdNum()}>£{(c.grossProfitPence / 100).toFixed(2)}</td>
                      <td style={tdNum(c.netProfitPence < 0 ? '#FF4C4C' : '#39FF6A')}>£{(c.netProfitPence / 100).toFixed(2)}</td>
                      <td style={tdNum()}>{c.profitPerUnitPence !== null ? `£${(c.profitPerUnitPence / 100).toFixed(2)}` : '—'}</td>
                      <td style={tdNum()}>{c.totalQty}</td>
                      <td style={tdNum()}>£{(c.totalSalesPence / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
