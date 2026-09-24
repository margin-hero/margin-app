import { supabase } from '@/lib/supabase'
import Nav from '@/components/Nav'

export default async function GridPage() {
  const { data, error } = await supabase.from('sku_channel_margins').select('*')

  if (error) {
    return <div style={{ padding: '2rem', background: '#1A1A1A', minHeight: '100vh', color: '#FF4C4C', fontFamily: 'sans-serif' }}>Error: {error.message}</div>
  }

  const rows = data || []
  const products = Array.from(new Set(rows.map((row) => row.product_name)))
  const channels = Array.from(new Set(rows.map((row) => row.channel)))

  function getMarginPercent(product: string, channel: string) {
    const matches = rows.filter((row) => row.product_name === product && row.channel === channel)
    if (matches.length === 0) return null
    const avg = matches.reduce((sum, row) => sum + row.margin_percent, 0) / matches.length
    return Math.round(avg * 10) / 10
  }

  function getMarginTotal(product: string, channel: string) {
    const matches = rows.filter((row) => row.product_name === product && row.channel === channel)
    if (matches.length === 0) return null
    return matches.reduce((sum, row) => sum + row.margin_pence, 0) / 100
  }

  function percentColors(margin: number | null) {
    if (margin === null) return { bg: 'transparent', text: '#555' }
    if (margin < 10) return { bg: 'rgba(255,76,76,0.15)', text: '#FF4C4C' }
    if (margin < 20) return { bg: 'rgba(220,255,0,0.12)', text: '#DCFF00' }
    return { bg: 'rgba(57,255,106,0.15)', text: '#39FF6A' }
  }

  function valueColors(margin: number | null) {
    if (margin === null) return { bg: 'transparent', text: '#555' }
    if (margin < 0) return { bg: 'rgba(255,76,76,0.15)', text: '#FF4C4C' }
    return { bg: 'rgba(57,255,106,0.15)', text: '#39FF6A' }
  }

  const pageStyle: React.CSSProperties = {
    background: '#1A1A1A',
    minHeight: '100vh',
    padding: '2rem',
    fontFamily: 'sans-serif',
    color: '#fff',
  }
  const cardStyle: React.CSSProperties = {
    background: '#232323',
    borderRadius: '12px',
    border: '0.5px solid #333',
    padding: '20px',
    marginTop: '1.5rem',
  }
  const thStyle: React.CSSProperties = { padding: '8px', textAlign: 'center', color: '#888', fontWeight: 500, fontSize: '13px' }
  const cellStyle = (colors: { bg: string; text: string }): React.CSSProperties => ({
    padding: '8px 4px',
    textAlign: 'center',
    borderRadius: '6px',
    background: colors.bg,
    color: colors.text,
    fontWeight: 500,
    fontSize: '14px',
  })

  return (
    <div style={{ background: '#1A1A1A', minHeight: '100vh' }}>
      <Nav />
      <div style={pageStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span style={{ fontSize: '20px', color: '#DCFF00' }}>↗</span>
        <span style={{ fontSize: '18px', fontWeight: 500 }}>Margin Hero</span>
      </div>
      <p style={{ color: '#888', fontSize: '13px', marginTop: 0 }}>SKU × channel margin overview</p>

      <div style={cardStyle}>
        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 14px' }}>Margin % by SKU and channel</p>
        <table style={{ borderCollapse: 'separate', borderSpacing: '4px', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left' }}>Product</th>
              {channels.map((channel) => (
                <th key={channel} style={thStyle}>{channel}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product}>
                <td style={{ padding: '8px', color: '#eee' }}>{product}</td>
                {channels.map((channel) => {
                  const margin = getMarginPercent(product, channel)
                  return (
                    <td key={channel} style={cellStyle(percentColors(margin))}>
                      {margin !== null ? `${margin}%` : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={cardStyle}>
        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 4px' }}>Margin £ by SKU and channel</p>
        <p style={{ fontSize: '12px', color: '#666', margin: '0 0 14px' }}>Total profit, summed across all orders for that product on that channel.</p>
        <table style={{ borderCollapse: 'separate', borderSpacing: '4px', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left' }}>Product</th>
              {channels.map((channel) => (
                <th key={channel} style={thStyle}>{channel}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product}>
                <td style={{ padding: '8px', color: '#eee' }}>{product}</td>
                {channels.map((channel) => {
                  const total = getMarginTotal(product, channel)
                  return (
                    <td key={channel} style={cellStyle(valueColors(total))}>
                      {total !== null ? `£${total.toFixed(2)}` : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  )
}
