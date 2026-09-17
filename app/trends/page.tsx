'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts'

type MarginRow = {
  product_name: string
  order_date: string
  revenue_pence: number
  margin_pence: number
}

export default function TrendsPage() {
  const [data, setData] = useState<MarginRow[]>([])
  const [products, setProducts] = useState<string[]>([])
  const [selectedProduct, setSelectedProduct] = useState<string>('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: rows, error } = await supabase
        .from('order_margins')
        .select('product_name, order_date, revenue_pence, margin_pence')

      if (error) {
        console.error(error)
        setLoading(false)
        return
      }

      setData(rows)
      setProducts(Array.from(new Set(rows.map((r) => r.product_name))).sort())
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>

  const filtered = selectedProduct === 'All' ? data : data.filter((r) => r.product_name === selectedProduct)

  // Group by month (YYYY-MM)
  const byMonth = new Map<string, { revenue: number; margin: number; count: number }>()
  for (const row of filtered) {
    const month = row.order_date.slice(0, 7) // "2026-08"
    if (!byMonth.has(month)) byMonth.set(month, { revenue: 0, margin: 0, count: 0 })
    const entry = byMonth.get(month)!
    entry.revenue += row.revenue_pence / 100
    entry.margin += row.margin_pence / 100
    entry.count += 1
  }

  const chartData = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, vals]) => ({
      month,
      Revenue: Math.round(vals.revenue * 100) / 100,
      Margin: Math.round(vals.margin * 100) / 100,
      Orders: vals.count,
    }))

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Revenue & Margin Trends</h1>

      <select
        value={selectedProduct}
        onChange={(e) => setSelectedProduct(e.target.value)}
        style={{ marginTop: '1rem', padding: '6px', fontSize: '14px' }}
      >
        <option value="All">All Products</option>
        {products.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      {chartData.length === 0 ? (
        <p style={{ marginTop: '1rem' }}>No data for this selection.</p>
      ) : (
        <div style={{ marginTop: '2rem', height: '400px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => `£${Number(value).toFixed(2)}`} />
              <Legend />
              <Line type="monotone" dataKey="Revenue" stroke="#2563eb" strokeWidth={2} />
              <Line type="monotone" dataKey="Margin" stroke="#16a34a" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '2rem', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: '6px' }}>Month</th>
            <th style={{ padding: '6px' }}>Revenue</th>
            <th style={{ padding: '6px' }}>Margin</th>
            <th style={{ padding: '6px' }}>Orders</th>
          </tr>
        </thead>
        <tbody>
          {chartData.map((row) => (
            <tr key={row.month} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '6px' }}>{row.month}</td>
              <td style={{ padding: '6px' }}>£{row.Revenue.toFixed(2)}</td>
              <td style={{ padding: '6px' }}>£{row.Margin.toFixed(2)}</td>
              <td style={{ padding: '6px' }}>{row.Orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
