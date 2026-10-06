'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { useMarginRanges } from '@/hooks/useMarginRanges'
import { pounds, ukMonth } from '@/lib/format'
import {
  chartRevenue, chartProfit, panelRaised, border, muted, text, red,
  pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, inputStyle, marginTier,
} from '@/lib/theme'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer, LabelList } from 'recharts'

type MarginRow = {
  product_name: string
  order_date: string
  revenue_pence: number
  margin_pence: number
  line_type: string
}

const axisTick = { fill: muted, fontSize: 12 }
const shortPounds = (value: number) => `£${Math.round(value).toLocaleString('en-GB')}`

export default function TrendsPage() {
  const ranges = useMarginRanges()
  const [data, setData] = useState<MarginRow[]>([])
  const [products, setProducts] = useState<string[]>([])
  const [selectedProduct, setSelectedProduct] = useState<string>('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data: rows, error } = await fetchAll((from, to) =>
        supabase
          .from('margin_lines')
          .select('product_name, order_date, revenue_pence, margin_pence, line_type') // sales and refunds
          .order('order_line_item_id')
          .range(from, to)
      )

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }

      setData(rows)
      setProducts(Array.from(new Set(rows.map((r) => r.product_name))).sort())
      setLoading(false)
    }
    load()
  }, [])

  const filtered = selectedProduct === 'All' ? data : data.filter((r) => r.product_name === selectedProduct)

  // Group by month (YYYY-MM): sum pence first, convert to pounds for the chart last
  const byMonth = new Map<string, { revenuePence: number; profitPence: number; count: number }>()
  for (const row of filtered) {
    const month = row.order_date.slice(0, 7) // "2026-08"
    const entry = byMonth.get(month) || { revenuePence: 0, profitPence: 0, count: 0 }
    entry.revenuePence += Number(row.revenue_pence) || 0
    entry.profitPence += Number(row.margin_pence) || 0
    if (row.line_type === 'sale') entry.count += 1 // refunds aren't order lines
    byMonth.set(month, entry)
  }

  const months = Array.from(byMonth.entries()).sort(([a], [b]) => a.localeCompare(b))
  const chartData = months.map(([month, v]) => ({
    month: ukMonth(month),
    Revenue: v.revenuePence / 100,
    'Net profit': v.profitPence / 100,
  }))
  const lastIndex = chartData.length - 1
  // Label only the final point of each line, so the lines are named without a number on every point
  const endLabel = (series: string) =>
    function EndLabel(props: { x?: number | string; y?: number | string; index?: number }) {
      if (props.index !== lastIndex) return null
      return (
        <text x={Number(props.x) + 8} y={Number(props.y)} dy={4} fill={text} fontSize={12} fontWeight={700}>
          {series}
        </text>
      )
    }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Dashboards</p>
      <h1 style={pageTitle}>Trends</h1>
      <p style={pageIntro}>Revenue and net profit month by month, for all products or one at a time.</p>

      <div style={{ marginTop: '20px' }}>
        <select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)} style={inputStyle} aria-label="Product">
          <option value="All">All products</option>
          {products.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p style={{ color: muted, marginTop: '20px' }}>Loading...</p>
      ) : error ? (
        <p style={{ color: red, marginTop: '20px' }}>Error: {error}</p>
      ) : chartData.length === 0 ? (
        <div style={cardStyle}><p style={{ color: muted, margin: 0 }}>No data for this selection.</p></div>
      ) : (
        <>
          <div style={cardStyle}>
            <p style={cardTitle}>Revenue vs net profit, by month</p>
            <div style={{ height: '380px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 90, bottom: 0, left: 10 }}>
                  <CartesianGrid stroke={border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={axisTick} axisLine={{ stroke: border }} tickLine={false} />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={shortPounds} width={70} />
                  <Tooltip
                    formatter={(value) => pounds(Math.round(Number(value) * 100))}
                    contentStyle={{ background: panelRaised, border: `1px solid ${border}`, borderRadius: '10px', color: text }}
                    labelStyle={{ color: muted, marginBottom: '4px' }}
                    itemStyle={{ color: text }}
                    cursor={{ stroke: muted, strokeDasharray: '3 3' }}
                  />
                  <Legend wrapperStyle={{ color: muted, fontSize: '13px', paddingTop: '8px' }} />
                  <Line type="monotone" dataKey="Revenue" stroke={chartRevenue} strokeWidth={2} dot={{ r: 4, fill: chartRevenue, strokeWidth: 0 }} activeDot={{ r: 6 }}>
                    <LabelList dataKey="Revenue" content={endLabel('Revenue')} />
                  </Line>
                  <Line type="monotone" dataKey="Net profit" stroke={chartProfit} strokeWidth={2} dot={{ r: 4, fill: chartProfit, strokeWidth: 0 }} activeDot={{ r: 6 }}>
                    <LabelList dataKey="Net profit" content={endLabel('Net profit')} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={cardStyle}>
            <p style={cardTitle}>By month</p>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Month</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Revenue</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Net profit</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Net margin</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Order lines</th>
                </tr>
              </thead>
              <tbody>
                {months.map(([month, v]) => {
                  const margin = v.revenuePence > 0 ? Math.round((v.profitPence / v.revenuePence) * 1000) / 10 : null
                  return (
                    <tr key={month}>
                      <td style={tdStyle}>{month}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{pounds(v.revenuePence)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{pounds(v.profitPence)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: marginTier(margin, ranges).fg }}>{margin === null ? '—' : `${margin}%`}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{v.count}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
