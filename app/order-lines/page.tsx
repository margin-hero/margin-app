import { connection } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadMarginRanges } from '@/lib/marginRanges'
import { pounds } from '@/lib/format'
import { red, muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, thStyle, tdStyle, marginTier } from '@/lib/theme'

// Unlisted page (not in the sidebar): every order line with its cost breakdown, for
// checking calculations while testing. Customers use /margins instead.
export default async function OrderLinesPage() {
  // Render on every visit so this shows live data, not a snapshot from build time
  await connection()

  const [{ data, error }, ranges] = await Promise.all([
    fetchAll((from, to) => supabase.from('order_margins').select('*').order('order_date', { ascending: false }).order('order_line_item_id').range(from, to)),
    loadMarginRanges(),
  ])

  if (error) {
    return <div style={{ ...pageStyle, color: red }}>Error: {error.message}</div>
  }

  const num: React.CSSProperties = { ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }
  const numHead: React.CSSProperties = { ...thStyle, textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Checking</p>
      <h1 style={pageTitle}>Order lines</h1>
      <p style={pageIntro}>Every order line with its full cost breakdown, newest first. Useful for checking exactly how a margin was worked out.</p>

      <div style={cardStyle}>
        <p style={{ fontSize: '13px', color: muted, margin: '0 0 12px' }}>{data.length.toLocaleString('en-GB')} order lines</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '1100px' }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Product</th>
                <th style={thStyle}>Store</th>
                <th style={numHead}>Qty</th>
                <th style={numHead}>Sale price</th>
                <th style={numHead}>Per unit</th>
                <th style={numHead}>Revenue</th>
                <th style={numHead}>Product cost</th>
                <th style={numHead}>Fees</th>
                <th style={numHead}>Shipping</th>
                <th style={numHead}>Other costs</th>
                <th style={numHead}>Net profit</th>
                <th style={numHead}>Net margin</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const margin = row.margin_percent === null ? null : Number(row.margin_percent)
                return (
                  <tr key={row.order_line_item_id}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: muted }}>{row.order_date}</td>
                    <td style={tdStyle}>{row.product_name}</td>
                    <td style={tdStyle}>{row.channel}</td>
                    <td style={num}>{row.qty}</td>
                    <td style={num}>{pounds(Number(row.sale_price_pence))}</td>
                    <td style={num}>{pounds(Number(row.price_per_unit_pence))}</td>
                    <td style={num}>{pounds(Number(row.revenue_pence))}</td>
                    <td style={num}>{pounds(Number(row.product_cost_pence))}</td>
                    <td style={num}>{pounds(Number(row.fees_pence))}</td>
                    <td style={num}>{pounds(Number(row.shipping_pence))}</td>
                    <td style={num}>{pounds(Number(row.other_cost_pence))}</td>
                    <td style={{ ...num, fontWeight: 700 }}>{pounds(Number(row.margin_pence))}</td>
                    <td style={{ ...num, fontWeight: 800, color: marginTier(margin, ranges).fg }}>{margin === null ? '—' : `${margin}%`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
