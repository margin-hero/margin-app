import { connection } from 'next/server'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { fetchAll } from '@/lib/fetchAll'
import { loadOverheadSetup, allocateOverheads } from '@/lib/overheads'
import { loadMarginRanges } from '@/lib/marginRanges'
import { lime, amber, green, red, muted, dim, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, marginTier, marginLegend } from '@/lib/theme'

type Cell = { revenuePence: number; marginPence: number }

export default async function GridPage({ searchParams }: PageProps<'/grid'>) {
  // Render on every visit so the grid shows live data, not a snapshot from build time
  await connection()
  const includeOverheads = (await searchParams).overheads === '1'
  const ranges = await loadMarginRanges()
  const legend = marginLegend(ranges)

  const { data, error } = await fetchAll((from, to) =>
    supabase
      .from('order_margins')
      .select('master_product_id, product_name, channel, store_id, order_date, effective_qty, revenue_pence, margin_pence')
      .order('order_line_item_id')
      .range(from, to)
  )

  if (error) {
    return <div style={{ ...pageStyle, color: red }}>Error: {error.message}</div>
  }

  // Sum revenue and margin per product × store FIRST, then work out the %
  // from those totals (never average per-order percentages).
  const products = new Map<string, string>() // id -> name
  const channelSet = new Set<string>()
  const cells = new Map<string, Cell>()

  // Optionally take each sale's share of overheads off its margin. The grid covers all
  // time, so overheads are counted from the first order date to the last.
  let overheadNote = ''
  let overheadShares: number[] = []
  if (includeOverheads && data.length > 0) {
    const dates = data.map((r) => r.order_date).sort()
    const allocation = allocateOverheads(data, await loadOverheadSetup(), dates[0], dates[dates.length - 1])
    overheadShares = allocation.shares
    overheadNote = `Includes £${(allocation.totalPence / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })} of overheads from ${dates[0]} to ${dates[dates.length - 1]}, shared across sales.`
  }

  for (const [i, row] of data.entries()) {
    products.set(row.master_product_id, row.product_name)
    channelSet.add(row.channel)
    const key = `${row.master_product_id}|${row.channel}`
    const cell = cells.get(key) || { revenuePence: 0, marginPence: 0 }
    cell.revenuePence += Number(row.revenue_pence) || 0
    cell.marginPence += (Number(row.margin_pence) || 0) - (overheadShares[i] || 0)
    cells.set(key, cell)
  }
  const productList = Array.from(products, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  const channels = Array.from(channelSet).sort()

  function marginPercent(productId: string, channel: string) {
    const cell = cells.get(`${productId}|${channel}`)
    if (!cell || cell.revenuePence === 0) return null
    return Math.round((cell.marginPence / cell.revenuePence) * 1000) / 10
  }

  function marginPounds(productId: string, channel: string) {
    const cell = cells.get(`${productId}|${channel}`)
    return cell ? cell.marginPence / 100 : null
  }

  const headStyle: React.CSSProperties = { fontSize: '12px', color: muted, fontWeight: 600, padding: '4px', textAlign: 'center' }
  const cellStyle = (bgColour: string, fg: string, outlined = false): React.CSSProperties => ({
    background: bgColour,
    color: fg,
    textAlign: 'center',
    fontSize: '16px',
    fontWeight: 800,
    padding: '12px 6px',
    borderRadius: '10px',
    outline: outlined ? `2px solid ${fg}` : 'none',
    outlineOffset: '-2px',
  })

  function table(render: (productId: string) => React.ReactNode[]) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: '6px', width: '100%', minWidth: `${160 + channels.length * 110}px` }}>
          <thead>
            <tr>
              <th style={{ ...headStyle, textAlign: 'left' }}>Product</th>
              {channels.map((channel) => (
                <th key={channel} style={headStyle}>{channel}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productList.map((product) => (
              <tr key={product.id}>
                <td style={{ padding: '4px', fontSize: '15px', fontWeight: 800, color: text }}>{product.name}</td>
                {render(product.id)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Dashboards</p>
      <h1 style={pageTitle}>SKU × store</h1>
      <p style={pageIntro}>Net margin for every product in every store, side by side.</p>
      <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { label: 'Before overheads', href: '/grid', on: !includeOverheads },
          { label: 'After overheads', href: '/grid?overheads=1', on: includeOverheads },
        ].map((t) => (
          <Link key={t.href} href={t.href} style={{ fontSize: '12px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px', textDecoration: 'none', background: t.on ? lime : 'transparent', color: t.on ? '#111112' : muted, border: `1px solid ${t.on ? lime : '#2E3029'}` }}>
            {t.label}
          </Link>
        ))}
        {overheadNote && <span style={{ fontSize: '12px', color: muted }}>{overheadNote}</span>}
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }}>
          <p style={{ ...cardTitle, margin: 0 }}>Net margin %{includeOverheads ? ' after overheads' : ''}</p>
          <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: muted }}>
            <span><span style={{ color: red }}>●</span> {legend[0]}</span>
            <span><span style={{ color: amber }}>●</span> {legend[1]}</span>
            <span><span style={{ color: green }}>●</span> {legend[2]}</span>
          </div>
        </div>
        {table((productId) => {
          const margins = channels.map((channel) => marginPercent(productId, channel))
          const known = margins.filter((m): m is number => m !== null)
          const best = known.length > 1 ? Math.max(...known) : null
          return margins.map((m, i) => {
            const tier = marginTier(m, ranges)
            return (
              <td key={channels[i]} style={cellStyle(tier.bg, tier.fg, m !== null && m === best)}>
                {m === null ? '—' : `${m}%`}
              </td>
            )
          })
        })}
        <p style={{ fontSize: '12px', color: dim, margin: '12px 0 0' }}>Outlined cell = the most profitable store for that product.</p>
      </div>

      <div style={cardStyle}>
        <p style={{ ...cardTitle, margin: '0 0 4px' }}>Net profit £{includeOverheads ? ' after overheads' : ''}</p>
        <p style={{ fontSize: '13px', color: muted, margin: '0 0 18px' }}>Total profit, summed across all orders for that product in that store.</p>
        {table((productId) =>
          channels.map((channel) => {
            const total = marginPounds(productId, channel)
            const colours =
              total === null ? { bg: 'transparent', fg: dim }
              : total < 0 ? { bg: 'rgba(255,76,76,0.16)', fg: red }
              : { bg: 'rgba(57,255,106,0.16)', fg: green }
            return (
              <td key={channel} style={cellStyle(colours.bg, colours.fg)}>
                {total === null ? '—' : `${total < 0 ? '−' : ''}£${Math.abs(total).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </td>
            )
          })
        )}
      </div>
    </div>
  )
}
