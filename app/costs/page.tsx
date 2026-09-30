'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { lime, red, muted, dim, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, thStyle, tdStyle } from '@/lib/theme'

type ProductCosts = {
  id: string
  sku: string
  name: string
  costPricePence: number | null // current cost price (as entered, inc. VAT)
  otherPence: number // current other per-unit costs combined
  futureCostFrom: string | null // cost price exists but only starts in the future
  shippingRules: number
  ordersNoCost: number // order lines where product cost came out as £0
  earliestNoCost: string | null
  ordersNoShipping: number
}

const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`

export default function CostsPage() {
  const [rows, setRows] = useState<ProductCosts[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(true)

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().slice(0, 10)
      const [products, cogs, shipping, noCost, noShipping] = await Promise.all([
        fetchAll((from, to) => supabase.from('master_products').select('id, standard_sku, name').order('id').range(from, to)),
        fetchAll((from, to) =>
          supabase.from('cogs_components').select('master_product_id, component_type, amount_pence, effective_from').order('id').range(from, to)
        ),
        fetchAll((from, to) => supabase.from('shipping_rules').select('master_product_id').order('id').range(from, to)),
        fetchAll((from, to) =>
          supabase.from('order_margins').select('master_product_id, order_date').eq('product_cost_pence', 0).order('order_line_item_id').range(from, to)
        ),
        fetchAll((from, to) =>
          supabase.from('order_margins').select('master_product_id').eq('shipping_pence', 0).order('order_line_item_id').range(from, to)
        ),
      ])
      const firstError = [products, cogs, shipping, noCost, noShipping].find((r) => r.error)?.error
      if (firstError) {
        setError(firstError.message)
        setLoading(false)
        return
      }

      // Current cost per product per cost type = the latest one already in effect today
      const current = new Map<string, Map<string, { amount: number; from: string }>>()
      const earliestCostPrice = new Map<string, string>()
      for (const c of cogs.data) {
        if (c.component_type === 'cost_price') {
          const prev = earliestCostPrice.get(c.master_product_id)
          if (!prev || c.effective_from < prev) earliestCostPrice.set(c.master_product_id, c.effective_from)
        }
        if (c.effective_from > today) continue
        const byType = current.get(c.master_product_id) || new Map()
        const prev = byType.get(c.component_type)
        if (!prev || c.effective_from > prev.from) byType.set(c.component_type, { amount: c.amount_pence, from: c.effective_from })
        current.set(c.master_product_id, byType)
      }

      const count = (list: { master_product_id: string }[]) => {
        const m = new Map<string, number>()
        list.forEach((r) => m.set(r.master_product_id, (m.get(r.master_product_id) || 0) + 1))
        return m
      }
      const shippingCounts = count(shipping.data)
      const noCostCounts = count(noCost.data)
      const noShippingCounts = count(noShipping.data)
      const earliestNoCost = new Map<string, string>()
      noCost.data.forEach((r) => {
        const prev = earliestNoCost.get(r.master_product_id)
        if (!prev || r.order_date < prev) earliestNoCost.set(r.master_product_id, r.order_date)
      })

      setRows(
        products.data.map((p) => {
          const byType = current.get(p.id)
          const costPrice = byType?.get('cost_price')?.amount ?? null
          let other = 0
          byType?.forEach((v, type) => { if (type !== 'cost_price') other += v.amount })
          const firstCost = earliestCostPrice.get(p.id) || null
          return {
            id: p.id,
            sku: p.standard_sku,
            name: p.name,
            costPricePence: costPrice,
            otherPence: other,
            futureCostFrom: costPrice === null && firstCost && firstCost > today ? firstCost : null,
            shippingRules: shippingCounts.get(p.id) || 0,
            ordersNoCost: noCostCounts.get(p.id) || 0,
            earliestNoCost: earliestNoCost.get(p.id) || null,
            ordersNoShipping: noShippingCounts.get(p.id) || 0,
          }
        })
      )
      setLoading(false)
    }
    load()
  }, [])

  const needsAttention = (r: ProductCosts) => r.costPricePence === null || r.ordersNoCost > 0 || r.ordersNoShipping > 0
  const problemCount = rows.filter(needsAttention).length
  const shown = rows
    .filter((r) => !onlyProblems || needsAttention(r))
    // Biggest problems first: most orders missing a cost, then SKU
    .sort((a, b) => b.ordersNoCost - a.ordersNoCost || b.ordersNoShipping - a.ordersNoShipping || a.sku.localeCompare(b.sku))

  function costAdvice(r: ProductCosts) {
    if (r.ordersNoCost === 0) return null
    // A cost exists but starts after some orders → it needs backdating, not adding
    if (r.costPricePence !== null || r.futureCostFrom) {
      return `${r.ordersNoCost} order line(s) before the cost starts: backdate it to ${r.earliestNoCost} or earlier`
    }
    return `${r.ordersNoCost} order line(s) have no product cost (showing inflated margin)`
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Costs</h1>
      <p style={pageIntro}>
        Every product&apos;s current costs in one place. A product with no cost price looks far more profitable than it is,
        so anything flagged here is making your margins look better than they really are.
      </p>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
          <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: problemCount ? red : lime }}>
            {loading ? 'Checking...' : problemCount ? `${problemCount} product(s) need attention` : 'All products have costs ✓'}
          </p>
          <label style={{ fontSize: '14px', color: muted, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} style={{ marginRight: '8px' }} />
            Only show products needing attention
          </label>
        </div>

        {error && <p style={{ color: red }}>Error: {error}</p>}
        {!loading && !error && shown.length === 0 && (
          <p style={{ color: muted, fontSize: '14px', margin: 0 }}>{onlyProblems ? 'Nothing needs attention.' : 'No products yet.'}</p>
        )}
        {shown.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '760px' }}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Cost price</th>
                  <th style={thStyle}>Other unit costs</th>
                  <th style={thStyle}>Shipping rules</th>
                  <th style={thStyle}>Needs attention</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const advice = costAdvice(r)
                  return (
                    <tr key={r.id}>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{r.sku}</td>
                      <td style={tdStyle}>{r.name}</td>
                      <td style={{ ...tdStyle, color: r.costPricePence === null ? red : text }}>
                        {r.costPricePence !== null ? pounds(r.costPricePence) : r.futureCostFrom ? `Starts ${r.futureCostFrom}` : 'Missing'}
                      </td>
                      <td style={{ ...tdStyle, color: r.otherPence ? text : dim }}>{r.otherPence ? pounds(r.otherPence) : '—'}</td>
                      <td style={{ ...tdStyle, color: r.shippingRules ? text : dim }}>{r.shippingRules || '—'}</td>
                      <td style={{ ...tdStyle, fontSize: '13px' }}>
                        {advice && <div style={{ color: red }}>{advice}</div>}
                        {r.ordersNoShipping > 0 && (
                          <div style={{ color: lime }}>{r.ordersNoShipping} order line(s) with £0 shipping: add a shipping rule for that quantity</div>
                        )}
                        {!advice && !r.ordersNoShipping && r.costPricePence === null && <div style={{ color: red }}>No cost price yet</div>}
                        {!needsAttention(r) && <span style={{ color: dim }}>—</span>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Link href={`/products/${r.id}`} style={{ color: lime, textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}>Edit costs →</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: '12px', color: dim, margin: '14px 0 0' }}>
          Costs are shown as entered (including VAT). Shipping flags only matter for stores where the channel doesn&apos;t report the real label cost.
        </p>
      </div>
    </div>
  )
}
