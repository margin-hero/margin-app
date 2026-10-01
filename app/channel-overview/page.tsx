'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadOverheadSetup, allocateOverheads } from '@/lib/overheads'

type MarginRow = {
  channel: string
  store_id: string
  effective_qty: number
  revenue_pence: number
  product_cost_pence: number
  margin_pence: number
}

type ChannelCard = {
  channel: string
  totalSalesPence: number
  totalQty: number
  orderCount: number
  aovPence: number
  grossProfitPence: number
  netProfitPence: number
  grossMarginPercent: number | null
  netMarginPercent: number | null
  overheadPence: number
  netAfterOverheadsPence: number
  netAfterOverheadsPercent: number | null
}

type Totals = { revenuePence: number; netPence: number; overheadPence: number; unallocatedPence: number }

function defaultFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10)
}

export default function ChannelOverviewPage() {
  const [dateFrom, setDateFrom] = useState(defaultFrom())
  const [dateTo, setDateTo] = useState(defaultTo())
  const [cards, setCards] = useState<ChannelCard[]>([])
  const [loading, setLoading] = useState(true)
  const [totals, setTotals] = useState<Totals | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: rows }, overheadSetup] = await Promise.all([fetchAll((from, to) =>
      supabase
        .from('order_margins')
        .select('channel, store_id, effective_qty, revenue_pence, product_cost_pence, margin_pence')
        .gte('order_date', dateFrom)
        .lte('order_date', dateTo)
        .order('order_line_item_id')
        .range(from, to)
    ), loadOverheadSetup()])

    // Share the overheads falling in this date range across these sales
    const marginRows = (rows || []) as MarginRow[]
    const allocation = allocateOverheads(marginRows, overheadSetup, dateFrom, dateTo)
    const overheadByChannel = new Map<string, number>()
    marginRows.forEach((r, i) => overheadByChannel.set(r.channel, (overheadByChannel.get(r.channel) || 0) + allocation.shares[i]))

    const byChannel = new Map<string, MarginRow[]>()
    for (const row of marginRows) {
      if (!byChannel.has(row.channel)) byChannel.set(row.channel, [])
      byChannel.get(row.channel)!.push(row)
    }

    const result: ChannelCard[] = []
    for (const [channel, groupRows] of byChannel) {
      const totalRevenue = groupRows.reduce((s, r) => s + r.revenue_pence, 0)
      const totalProductCost = groupRows.reduce((s, r) => s + r.product_cost_pence, 0)
      const totalNetProfit = groupRows.reduce((s, r) => s + r.margin_pence, 0)
      const totalQty = groupRows.reduce((s, r) => s + r.effective_qty, 0)
      const orderCount = groupRows.length
      const grossProfit = totalRevenue - totalProductCost
      const overhead = Math.round(overheadByChannel.get(channel) || 0)
      const netAfterOverheads = totalNetProfit - overhead

      result.push({
        channel,
        totalSalesPence: totalRevenue,
        totalQty,
        orderCount,
        aovPence: orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0,
        grossProfitPence: grossProfit,
        netProfitPence: totalNetProfit,
        grossMarginPercent: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : null,
        netMarginPercent: totalRevenue > 0 ? Math.round((totalNetProfit / totalRevenue) * 1000) / 10 : null,
        overheadPence: overhead,
        netAfterOverheadsPence: netAfterOverheads,
        netAfterOverheadsPercent: totalRevenue > 0 ? Math.round((netAfterOverheads / totalRevenue) * 1000) / 10 : null,
      })
    }

    result.sort((a, b) => b.totalSalesPence - a.totalSalesPence)
    setCards(result)
    setTotals({
      revenuePence: marginRows.reduce((s, r) => s + Number(r.revenue_pence), 0),
      netPence: marginRows.reduce((s, r) => s + Number(r.margin_pence), 0),
      overheadPence: Math.round(allocation.totalPence),
      unallocatedPence: Math.round(allocation.unallocatedPence),
    })
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function marginColor(pct: number | null) {
    if (pct === null) return '#555'
    if (pct < 10) return '#FF4C4C'
    if (pct < 20) return '#FFB020' // amber
    return '#39FF6A'
  }

  return (
    <div style={{ background: '#1A1A1A', minHeight: '100vh', color: '#fff', fontFamily: 'sans-serif' }}>
      <div style={{ padding: '2rem' }}>
        <p style={{ color: '#888', fontSize: '13px', marginTop: 0, marginBottom: '4px' }}>Overview</p>
        <h1 style={{ margin: '0 0 16px', fontSize: '22px' }}>Channel performance</h1>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
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

        {!loading && totals && totals.overheadPence > 0 && (
          <div style={{ background: '#232323', borderRadius: '12px', border: '0.5px solid #333', padding: '14px 18px', marginBottom: '14px', fontSize: '13px', display: 'flex', gap: '28px', flexWrap: 'wrap' }}>
            <span><span style={{ color: '#888' }}>Net profit (all stores) </span>£{(totals.netPence / 100).toFixed(2)}</span>
            <span><span style={{ color: '#888' }}>Overheads in this period </span>−£{(totals.overheadPence / 100).toFixed(2)}</span>
            <span>
              <span style={{ color: '#888' }}>Net after overheads </span>
              <strong style={{ color: totals.netPence - totals.overheadPence < 0 ? '#FF4C4C' : '#39FF6A' }}>
                £{((totals.netPence - totals.overheadPence) / 100).toFixed(2)}
                {totals.revenuePence > 0 && ` (${(((totals.netPence - totals.overheadPence) / totals.revenuePence) * 100).toFixed(1)}%)`}
              </strong>
            </span>
            {totals.unallocatedPence > 0 && (
              <span style={{ color: '#FFB020' }}>£{(totals.unallocatedPence / 100).toFixed(2)} of overheads had no sales in this period to be shared across (e.g. a store-only overhead for a store with no orders), so they aren&apos;t in any card below, but they are in the total.</span>
            )}
          </div>
        )}

        {loading ? (
          <p style={{ color: '#888' }}>Loading...</p>
        ) : cards.length === 0 ? (
          <p style={{ color: '#888' }}>No orders in this date range.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
            {cards.map((c) => (
              <div key={c.channel} style={{ background: '#232323', borderRadius: '12px', border: '0.5px solid #333', padding: '18px' }}>
                <p style={{ fontSize: '13px', color: '#DCFF00', fontWeight: 500, margin: '0 0 10px' }}>{c.channel}</p>
                <p style={{ fontSize: '28px', fontWeight: 500, margin: '0 0 2px' }}>£{(c.totalSalesPence / 100).toFixed(2)}</p>
                <p style={{ fontSize: '12px', color: '#888', margin: '0 0 14px' }}>
                  {c.orderCount} orders · {c.totalQty} units · £{(c.aovPence / 100).toFixed(2)} AOV
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', borderTop: '0.5px solid #333', paddingTop: '10px' }}>
                  <span style={{ color: '#888' }}>Gross margin</span>
                  <span style={{ color: marginColor(c.grossMarginPercent), fontWeight: 500 }}>
                    {c.grossMarginPercent !== null ? `${c.grossMarginPercent}%` : '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '6px' }}>
                  <span style={{ color: '#888' }}>Net margin</span>
                  <span style={{ color: marginColor(c.netMarginPercent), fontWeight: 500 }}>
                    {c.netMarginPercent !== null ? `${c.netMarginPercent}%` : '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '10px', borderTop: '0.5px solid #333', paddingTop: '10px' }}>
                  <span style={{ color: '#888' }}>Gross profit</span>
                  <span style={{ fontWeight: 500 }}>£{(c.grossProfitPence / 100).toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '6px' }}>
                  <span style={{ color: '#888' }}>Net profit</span>
                  <span style={{ color: c.netProfitPence < 0 ? '#FF4C4C' : '#39FF6A', fontWeight: 500 }}>
                    £{(c.netProfitPence / 100).toFixed(2)}
                  </span>
                </div>
                {c.overheadPence > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '6px' }}>
                      <span style={{ color: '#888' }}>Share of overheads</span>
                      <span style={{ fontWeight: 500 }}>−£{(c.overheadPence / 100).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '6px', borderTop: '0.5px solid #333', paddingTop: '6px' }}>
                      <span style={{ color: '#888' }}>Net after overheads</span>
                      <span style={{ color: marginColor(c.netAfterOverheadsPercent), fontWeight: 600 }}>
                        £{(c.netAfterOverheadsPence / 100).toFixed(2)}
                        {c.netAfterOverheadsPercent !== null && ` · ${c.netAfterOverheadsPercent}%`}
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
