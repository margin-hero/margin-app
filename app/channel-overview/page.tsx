'use client'

import { useEffect, useState } from 'react'
import { loadMarginSummary, type SummaryRow } from '@/lib/marginSummary'
import { useMarginRanges } from '@/hooks/useMarginRanges'
import { marginTier, red, green, amber, muted, text, border, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, inputStyle } from '@/lib/theme'
import { pounds, wholePounds, wholePercent } from '@/lib/format'
import DateRangeBar from '@/components/DateRangeBar'
import { loadOverheadSetup, allocateOverheads } from '@/lib/overheads'
import { loadStores } from '@/lib/stores'
import { loadAdSpend, sumAdSpend, acosPercent, tacosPercent } from '@/lib/adSpend'


type ChannelCard = {
  storeId: string
  storeName: string
  platform: string // e.g. OnBuy: the card's main title
  grossSalesPence: number // what customers paid, inc. VAT and delivery
  totalSalesPence: number
  totalQty: number // units sold
  orderCount: number
  refundedUnits: number
  refundsPence: number // what customers got back, inc. VAT and delivery (like gross sales)
  refundRatePercent: number | null // refunded units ÷ units sold
  aovPence: number
  grossProfitPence: number
  netProfitPence: number
  grossMarginPercent: number | null
  netMarginPercent: number | null
  adCostPence: number // ad spend (cost to the business: inc. VAT if not VAT registered)
  acosPercent: number | null // ad spend ÷ ad sales
  tacosPercent: number | null // ad spend ÷ all sales
  netAfterAdsPence: number
  netAfterAdsPercent: number | null
  overheadPence: number
  netAfterOverheadsPence: number // after ads too
  netAfterOverheadsPercent: number | null
}

type Totals = { revenuePence: number; netPence: number; adPence: number; overheadPence: number; unallocatedPence: number }

// How the store cards can be ordered. Percentages with no sales (null) always go last.
const SORTS = {
  gross: { label: 'Gross sales (high to low)', compare: (a: ChannelCard, b: ChannelCard) => b.grossSalesPence - a.grossSalesPence },
  net: { label: 'Net sales (high to low)', compare: (a: ChannelCard, b: ChannelCard) => b.totalSalesPence - a.totalSalesPence },
  profit: { label: 'Net profit (high to low)', compare: (a: ChannelCard, b: ChannelCard) => b.netProfitPence - a.netProfitPence },
  margin: { label: 'Net margin % (high to low)', compare: (a: ChannelCard, b: ChannelCard) => (b.netMarginPercent ?? -Infinity) - (a.netMarginPercent ?? -Infinity) },
  marginLow: { label: 'Net margin % (low to high)', compare: (a: ChannelCard, b: ChannelCard) => (a.netMarginPercent ?? Infinity) - (b.netMarginPercent ?? Infinity) },
  refunds: { label: 'Refund rate (high to low)', compare: (a: ChannelCard, b: ChannelCard) => (b.refundRatePercent ?? -Infinity) - (a.refundRatePercent ?? -Infinity) },
  name: { label: 'Store A–Z', compare: (a: ChannelCard, b: ChannelCard) => (a.platform || a.storeName).localeCompare(b.platform || b.storeName) || a.storeName.localeCompare(b.storeName) },
} as const
type SortKey = keyof typeof SORTS
const SORT_STORAGE_KEY = 'mh-channel-overview-sort'

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
  const [sortBy, setSortBy] = useState<SortKey>('net')
  const [loading, setLoading] = useState(true)
  const [totals, setTotals] = useState<Totals | null>(null)

  async function load(dateFrom: string = rangeFrom, dateTo: string = rangeTo) {
    setLoading(true)
    // Sales plus refunds (negative rows, on their refund date), so the figures are net of refunds
    // (added up in the database: one total per store × product × store SKU × month)
    const [{ data: rows }, overheadSetup, stores] = await Promise.all([
      loadMarginSummary({ from: dateFrom, to: dateTo }),
      loadOverheadSetup(),
      loadStores(),
    ])
    const adsByStore = sumAdSpend(await loadAdSpend({ from: dateFrom, to: dateTo }), (l) => l.store_id)

    // Share the overheads falling in this date range across these sales
    const marginRows = rows
    const allocation = allocateOverheads(marginRows, overheadSetup, dateFrom, dateTo)
    const overheadByStore = new Map<string, number>()
    marginRows.forEach((r, i) => overheadByStore.set(r.store_id, (overheadByStore.get(r.store_id) || 0) + allocation.shares[i]))

    // One card per store (by id, so two stores with the same name stay separate)
    const byStore = new Map<string, SummaryRow[]>()
    for (const row of marginRows) {
      if (!byStore.has(row.store_id)) byStore.set(row.store_id, [])
      byStore.get(row.store_id)!.push(row)
    }
    // A store with ad spend but no sales in the period still gets a card (it made a loss)
    for (const storeId of adsByStore.keys()) if (!byStore.has(storeId)) byStore.set(storeId, [])

    const result: ChannelCard[] = []
    for (const [storeId, groupRows] of byStore) {
      const store = stores.find((st) => st.id === storeId)
      const sales = groupRows.filter((r) => r.line_type === 'sale')
      const totalRevenue = groupRows.reduce((s, r) => s + Number(r.revenue_pence), 0)
      const totalProductCost = groupRows.reduce((s, r) => s + Number(r.product_cost_pence), 0)
      const totalNetProfit = groupRows.reduce((s, r) => s + Number(r.margin_pence), 0)
      // Orders, units and average order are about sales; refunds are shown separately
      const totalQty = sales.reduce((s, r) => s + r.effective_qty, 0)
      const orderCount = sales.reduce((s, r) => s + r.lines, 0)
      const salesRevenue = sales.reduce((s, r) => s + Number(r.revenue_pence), 0)
      const refundedUnits = groupRows.reduce((s, r) => s + r.refunded_units, 0)
      const refunds = groupRows.filter((r) => r.line_type === 'refund').reduce((s, r) => s - Number(r.gross_sales_pence), 0)
      const grossProfit = totalRevenue - totalProductCost
      const ads = adsByStore.get(storeId)
      const adCost = ads?.costPence ?? 0
      const netAfterAds = totalNetProfit - adCost
      const grossSales = groupRows.reduce((s, r) => s + Number(r.gross_sales_pence), 0)
      const overhead = Math.round(overheadByStore.get(storeId) || 0)
      const netAfterOverheads = netAfterAds - overhead

      result.push({
        storeId,
        storeName: store?.name ?? groupRows[0]?.channel ?? '?',
        platform: store?.platforms?.name ?? '',
        grossSalesPence: grossSales,
        totalSalesPence: totalRevenue,
        totalQty,
        orderCount,
        refundedUnits,
        refundsPence: refunds,
        refundRatePercent: totalQty > 0 ? Math.round((refundedUnits / totalQty) * 1000) / 10 : null,
        aovPence: orderCount > 0 ? Math.round(salesRevenue / orderCount) : 0,
        grossProfitPence: grossProfit,
        netProfitPence: totalNetProfit,
        grossMarginPercent: totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : null,
        netMarginPercent: totalRevenue > 0 ? Math.round((totalNetProfit / totalRevenue) * 1000) / 10 : null,
        adCostPence: adCost,
        acosPercent: acosPercent(ads),
        tacosPercent: tacosPercent(ads, grossSales),
        netAfterAdsPence: netAfterAds,
        netAfterAdsPercent: totalRevenue > 0 ? Math.round((netAfterAds / totalRevenue) * 1000) / 10 : null,
        overheadPence: overhead,
        netAfterOverheadsPence: netAfterOverheads,
        netAfterOverheadsPercent: totalRevenue > 0 ? Math.round((netAfterOverheads / totalRevenue) * 1000) / 10 : null,
      })
    }

    setCards(result)
    setTotals({
      revenuePence: marginRows.reduce((s, r) => s + Number(r.revenue_pence), 0),
      netPence: marginRows.reduce((s, r) => s + Number(r.margin_pence), 0),
      adPence: Array.from(adsByStore.values()).reduce((s, a) => s + a.costPence, 0),
      overheadPence: Math.round(allocation.totalPence),
      unallocatedPence: Math.round(allocation.unallocatedPence),
    })
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Remember the chosen order in this browser
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_STORAGE_KEY)
      if (saved && saved in SORTS) setSortBy(saved as SortKey)
    } catch {}
  }, [])
  function changeSort(key: SortKey) {
    setSortBy(key)
    try {
      localStorage.setItem(SORT_STORAGE_KEY, key)
    } catch {}
  }
  const sortedCards = [...cards].sort((a, b) => SORTS[sortBy].compare(a, b) || a.storeName.localeCompare(b.storeName))

  // Coloured on the whole-number % that's shown, so e.g. 9.6% (shown as 10%) isn't red beside a 10% cut-off
  function marginColor(pct: number | null) {
    return marginTier(pct === null ? null : Math.round(pct), ranges).fg
  }

  const oneLine: React.CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

  const row = (label: string, value: React.ReactNode, color: string = text, divider = false) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: '12px', fontSize: '13px', padding: '7px 0', borderTop: divider ? `1px solid ${border}` : 'none' }}>
      <span style={{ color: muted }}>{label}</span>
      {/* a long value (e.g. seven figures and a %) drops under its label rather than being cut off */}
      <span style={{ color, fontWeight: 700, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Dashboards</p>
      <h1 style={pageTitle}>Channel Overview</h1>
      <p style={pageIntro}>Sales and margin for each store over the dates you choose, with each store&apos;s ad spend (ACOS = ad spend ÷ ad sales, TACOS = ad spend ÷ all gross sales) and share of overheads. Gross sales is what customers paid (including VAT and delivery); net sales takes off the VAT for VAT-registered stores, and margins are worked out from net sales. Refunds are taken off in the period they happened.</p>

      <DateRangeBar
        from={rangeFrom}
        to={rangeTo}
        onChange={(f, t) => { setRangeFrom(f); setRangeTo(t) }}
        onApply={(f, t) => load(f, t)}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px' }}>
        <label htmlFor="channel-sort" style={{ fontSize: '13px', color: muted }}>Sort by</label>
        <select id="channel-sort" value={sortBy} onChange={(e) => changeSort(e.target.value as SortKey)} style={inputStyle}>
          {(Object.keys(SORTS) as SortKey[]).map((key) => (
            <option key={key} value={key}>{SORTS[key].label}</option>
          ))}
        </select>
      </div>

      {!loading && totals && (totals.overheadPence > 0 || totals.adPence > 0) && (
        <div style={{ ...cardStyle, display: 'flex', gap: '32px', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <p style={{ ...cardTitle, margin: '0 0 6px' }}>Net profit · all stores</p>
            <p style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>{wholePounds(totals.netPence)}</p>
          </div>
          {totals.adPence > 0 && (
            <div>
              <p style={{ ...cardTitle, margin: '0 0 6px' }}>Ad spend in period</p>
              <p style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>{wholePounds(-totals.adPence)}</p>
            </div>
          )}
          {totals.overheadPence > 0 && (
            <div>
              <p style={{ ...cardTitle, margin: '0 0 6px' }}>Overheads in period</p>
              <p style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>{wholePounds(-totals.overheadPence)}</p>
            </div>
          )}
          <div>
            <p style={{ ...cardTitle, margin: '0 0 6px' }}>Net after {[totals.adPence > 0 && 'ads', totals.overheadPence > 0 && 'overheads'].filter(Boolean).join(' & ')}</p>
            <p style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: totals.netPence - totals.adPence - totals.overheadPence < 0 ? red : green }}>
              {wholePounds(totals.netPence - totals.adPence - totals.overheadPence)}
              {totals.revenuePence > 0 && (
                <span style={{ fontSize: '14px', marginLeft: '8px' }}>
                  {wholePercent(((totals.netPence - totals.adPence - totals.overheadPence) / totals.revenuePence) * 100)}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px', marginTop: '20px' }}>
          {sortedCards.map((c) => (
            <div key={c.storeId} style={{ ...cardStyle, marginTop: 0 }}>
              {/* Every heading line is kept to one line (long names are cut short with "…") so the
                  rows below line up across cards */}
              <p style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: text, ...oneLine }} title={c.platform || c.storeName}>{c.platform || c.storeName}</p>
              <p style={{ ...cardTitle, margin: '2px 0 12px', ...oneLine }} title={c.storeName}>{c.platform ? c.storeName : ' '}</p>
              {/* Net sales under gross sales */}
              <div style={{ display: 'flex', flexDirection: 'column', rowGap: '8px', margin: '0 0 12px' }}>
                <div>
                  <p style={{ fontSize: '11px', color: muted, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Gross sales</p>
                  <p style={{ fontSize: '24px', fontWeight: 800, margin: 0, whiteSpace: 'nowrap' }}>{wholePounds(c.grossSalesPence)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '11px', color: muted, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Net sales</p>
                  <p style={{ fontSize: '24px', fontWeight: 800, margin: 0, whiteSpace: 'nowrap' }}>{wholePounds(c.totalSalesPence)}</p>
                </div>
              </div>
              {/* Groups, each starting with a divider; refunds always shown so the cards line up */}
              {row('Gross margin', wholePercent(c.grossMarginPercent), marginColor(c.grossMarginPercent), true)}
              {row('Net margin', wholePercent(c.netMarginPercent), marginColor(c.netMarginPercent))}
              {row('Gross profit', wholePounds(c.grossProfitPence), text, true)}
              {row('Net profit', wholePounds(c.netProfitPence), c.netProfitPence < 0 ? red : green)}
              {row('Orders', c.orderCount.toLocaleString('en-GB'), text, true)}
              {row('Units', c.totalQty.toLocaleString('en-GB'))}
              {row('Avg order value', pounds(c.aovPence))}
              {row('Refunds', wholePounds(-c.refundsPence), text, true)}
              {row('Refunded units', c.refundedUnits.toLocaleString('en-GB'))}
              {row('Refund rate', wholePercent(c.refundRatePercent))}
              {c.adCostPence > 0 && (
                <>
                  {row('Ad spend', wholePounds(-c.adCostPence), text, true)}
                  {row('ACOS', wholePercent(c.acosPercent))}
                  {row('TACOS', wholePercent(c.tacosPercent))}
                  {row('Net after ads', `${wholePounds(c.netAfterAdsPence)}${c.netAfterAdsPercent !== null ? ` · ${wholePercent(c.netAfterAdsPercent)}` : ''}`, marginColor(c.netAfterAdsPercent))}
                </>
              )}
              {c.overheadPence > 0 && (
                <>
                  {row('Share of overheads', wholePounds(-c.overheadPence), text, c.adCostPence === 0)}
                  {row(c.adCostPence > 0 ? 'Net after ads & overheads' : 'Net after overheads', `${wholePounds(c.netAfterOverheadsPence)}${c.netAfterOverheadsPercent !== null ? ` · ${wholePercent(c.netAfterOverheadsPercent)}` : ''}`, marginColor(c.netAfterOverheadsPercent), true)}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
