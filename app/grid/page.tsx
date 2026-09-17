import { supabase } from '@/lib/supabase'

export default async function GridPage() {
  const { data, error } = await supabase.from('sku_channel_margins').select('*')

  if (error) {
    return <div style={{ padding: '2rem' }}>Error: {error.message}</div>
  }

  // Get unique products and channels
  const products = Array.from(new Set(data.map((row) => row.product_name)))
  const channels = Array.from(new Set(data.map((row) => row.channel)))

  // Average margin % for a given product + channel combo, across all its orders
  function getMarginPercent(product: string, channel: string) {
    const matches = data.filter((row) => row.product_name === product && row.channel === channel)
    if (matches.length === 0) return null
    const avg = matches.reduce((sum, row) => sum + row.margin_percent, 0) / matches.length
    return Math.round(avg * 10) / 10
  }

  // Total margin £ for a given product + channel combo, summed across all its orders
  function getMarginTotal(product: string, channel: string) {
    const matches = data.filter((row) => row.product_name === product && row.channel === channel)
    if (matches.length === 0) return null
    return matches.reduce((sum, row) => sum + row.margin_pence, 0) / 100
  }

  function cellColorPercent(margin: number | null) {
    if (margin === null) return '#f5f5f5'
    if (margin < 10) return '#fde2e2'
    if (margin < 20) return '#fdf0d5'
    return '#e2f5e2'
  }

  function cellColorValue(margin: number | null) {
    if (margin === null) return '#f5f5f5'
    if (margin < 0) return '#fde2e2'
    return '#e2f5e2'
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Margin % by SKU and Channel</h1>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Product</th>
            {channels.map((channel) => (
              <th key={channel} style={{ padding: '8px', textAlign: 'center' }}>{channel}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px' }}>{product}</td>
              {channels.map((channel) => {
                const margin = getMarginPercent(product, channel)
                return (
                  <td
                    key={channel}
                    style={{
                      padding: '8px',
                      textAlign: 'center',
                      backgroundColor: cellColorPercent(margin),
                    }}
                  >
                    {margin !== null ? `${margin}%` : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <h1 style={{ marginTop: '2.5rem' }}>Margin £ by SKU and Channel</h1>
      <p style={{ color: '#666', fontSize: '13px' }}>Total profit, summed across all orders for that product on that channel.</p>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>Product</th>
            {channels.map((channel) => (
              <th key={channel} style={{ padding: '8px', textAlign: 'center' }}>{channel}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px' }}>{product}</td>
              {channels.map((channel) => {
                const total = getMarginTotal(product, channel)
                return (
                  <td
                    key={channel}
                    style={{
                      padding: '8px',
                      textAlign: 'center',
                      backgroundColor: cellColorValue(total),
                    }}
                  >
                    {total !== null ? `£${total.toFixed(2)}` : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
