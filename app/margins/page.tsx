import { supabase } from '@/lib/supabase'

export default async function MarginsPage() {
  const { data, error } = await supabase.from('order_margins').select('*')

  if (error) {
    return <div style={{ padding: '2rem' }}>Error: {error.message}</div>
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Order Margins</h1>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Product</th>
            <th style={{ padding: '8px' }}>Channel</th>
            <th style={{ padding: '8px' }}>Date</th>
            <th style={{ padding: '8px' }}>Qty</th>
            <th style={{ padding: '8px' }}>Sale Price</th>
            <th style={{ padding: '8px' }}>Price/Unit</th>
            <th style={{ padding: '8px' }}>Revenue</th>
            <th style={{ padding: '8px' }}>Product Cost</th>
            <th style={{ padding: '8px' }}>Fees</th>
            <th style={{ padding: '8px' }}>Shipping</th>
            <th style={{ padding: '8px' }}>Other Costs</th>
            <th style={{ padding: '8px' }}>Margin</th>
            <th style={{ padding: '8px' }}>Margin %</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.order_line_item_id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px' }}>{row.product_name}</td>
              <td style={{ padding: '8px' }}>{row.channel}</td>
              <td style={{ padding: '8px' }}>{row.order_date}</td>
              <td style={{ padding: '8px' }}>{row.qty}</td>
              <td style={{ padding: '8px' }}>£{(row.sale_price_pence / 100).toFixed(2)}</td>
              <td style={{ padding: '8px' }}>£{(row.price_per_unit_pence / 100).toFixed(2)}</td>
              <td style={{ padding: '8px' }}>£{(row.revenue_pence / 100).toFixed(2)}</td>
              <td style={{ padding: '8px' }}>£{(row.product_cost_pence / 100).toFixed(2)}</td>
              <td style={{ padding: '8px' }}>£{(row.fees_pence / 100).toFixed(2)}</td>
              <td style={{ padding: '8px' }}>£{(row.shipping_pence / 100).toFixed(2)}</td>
              <td style={{ padding: '8px' }}>£{(row.other_cost_pence / 100).toFixed(2)}</td>
              <td style={{ padding: '8px' }}>£{(row.margin_pence / 100).toFixed(2)}</td>
              <td style={{ padding: '8px' }}>{row.margin_percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
