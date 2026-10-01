'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { useMarginRanges } from '@/hooks/useMarginRanges'
import { marginTier, red, green, amber, muted, dim, text, border, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle } from '@/lib/theme'
import { pounds, percent } from '@/lib/format'
import DateRangeBar from '@/components/DateRangeBar'
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
  d.setDate(d.getDate() - 29) // last 30 days including today
  return d.toISOString().slice(0, 10)
}
function defaultTo() {
  return new Date().toISOString().slice(0, 10)
}

export default function ChannelOverviewPage() {
  const ranges = useMarginRanges()
  const [rangeFrom, setRangeFrom] = useState(defaultFrom())
  const [rangeTo, setRangeTo] = useState(defaultTo())
  const [cards, setCards] = useState<ChannelCard[]>([])
  const [loading, setLoading] = useState(true)
  const [totals, setTotals] = useState<Totals | null>(null)

  async function load(dateFrom: string = rangeFrom, dateTo: string = rangeTo) {
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
    return marginTier(pct, ranges).fg
  }

  const row = (label: string, value: React.ReactNode, color: string = text, divider = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '7px 0', borderTop: divider ? `1px solid ${border}` : 'none' }}>
      <span style={{ color: muted }}>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </div>
  )

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Dashboards</p>
      <h1 style={pageTitle}>Channel Overview</h1>
      <p style={pageIntro}>Sales and margin for each store over the dates you choose, with each store&apos;s share of overheads.</p>

      <DateRangeBar
        from={rangeFrom}
        to={rangeTo}
        onChange={(f, t) => { setRangeFrom(f); setRangeTo(t) }}
        onApply={(f, t) => load(f, t)}
      />

      {!loading && totals && totals.overheadPence > 0 && (
        <div style={{ ...cardStyle, display: 'flex', gap: '32px', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <p style={{ ...cardTitle, margin: '0 0 6px' }}>Net profit · all stores</p>
            <p style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>{pounds(totals.netPence)}</p>
          </div>
          <div>
            <p style={{ ...cardTitle, margin: '0 0 6px' }}>Overheads in period</p>
            <p style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>{pounds(-totals.overheadPence)}</p>
          </div>
          <div>
            <p style={{ ...cardTitle, margin: '0 0 6px' }}>Net after overheads</p>
            <p style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: totals.netPence - totals.overheadPence < 0 ? red : green }}>
              {pounds(totals.netPence - totals.overheadPence)}
              {totals.revenuePence > 0 && (
                <span style={{ fontSize: '14px', marginLeft: '8px' }}>
                  {(((totals.netPence - totals.overheadPence) / totals.revenuePence) * 100).toFixed(1)}%
                </span>
              )}
            </p>
          </div>
          {totals.unallocatedPence > 0 && (
            <p style={{ color: amber, fontSize: '13px', margin: 0, flexBasis: '100%' }}>
              {pounds(totals.unallocatedPence)} of overheads had no sales in this period to be shared across (e.g. a store-only overhead for a store with no orders), so it isn&apos;t in any store below, but it is in the total.
            </p>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ color: muted, marginTop: '20px' }}>Loading...</p>
      ) : cards.length === 0 ? (
        <div style={cardStyle}><p style={{ color: muted, margin: 0 }}>No orders in this date range.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px', marginTop: '20px' }}>
          {cards.map((c) => (
            <div key={c.channel} style={{ ...cardStyle, marginTop: 0 }}>
              <p style={{ ...cardTitle, margin: '0 0 12px', color: text }}>{c.channel}</p>
              <p style={{ fontSize: '30px', fontWeight: 800, margin: '0 0 4px' }}>{pounds(c.totalSalesPence)}</p>
              <p style={{ fontSize: '12px', color: dim, margin: '0 0 14px' }}>
                {c.orderCount} orders · {c.totalQty} units · {pounds(c.aovPence)} avg order
              </p>
              {row('Gross margin', percent(c.grossMarginPercent), marginColor(c.grossMarginPercent), true)}
              {row('Net margin', percent(c.netMarginPercent), marginColor(c.netMarginPercent))}
              {row('Gross profit', pounds(c.grossProfitPence), text, true)}
              {row('Net profit', pounds(c.netProfitPence), c.netProfitPence < 0 ? red : green)}
              {c.overheadPence > 0 && (
                <>
                  {row('Share of overheads', pounds(-c.overheadPence))}
                  {row('Net after overheads', `${pounds(c.netAfterOverheadsPence)}${c.netAfterOverheadsPercent !== null ? ` · ${c.netAfterOverheadsPercent}%` : ''}`, marginColor(c.netAfterOverheadsPercent), true)}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
