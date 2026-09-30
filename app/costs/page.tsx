'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadCostTypes, hasDoubleCountRisk } from '@/lib/costTypes'
import { lime, amber, red, muted, dim, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, thStyle, tdStyle } from '@/lib/theme'

type ProductCosts = {
  id: string
  sku: string
  name: string
  landedPence: number | null // current landed cost: all-in, or product cost + freight + duty (as entered, inc. VAT)
  otherUnitPence: number // current other per-unit costs combined
  perOrderPence: number // current per-order costs combined
  futureCostFrom: string | null // a landed cost exists but only starts in the future
  doubleCount: boolean // all-in landed cost AND its parts are both in effect
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
      const [costTypes, products, cogs, shipping, noCost, noShipping] = await Promise.all([
        loadCostTypes(),
        fetchAll((from, to) => supabase.from('master_products').select('id, standard_sku, name').order('id').range(from, to)),
        fetchAll((from, to) =>
          supabase.from('cogs_components').select('master_product_id, component_type, description, amount_pence, effective_from').order('id').range(from, to)
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

      const typeByCode = new Map(costTypes.map((t) => [t.code, t]))

      // Current costs per product = the latest row per (type, description) already in
      // effect today — the same rule the margin calculation uses
      const current = new Map<string, Map<string, { type: string; amount: number; from: string }>>()
      const earliestLanded = new Map<string, string>()
      for (const c of cogs.data) {
        if (typeByCode.get(c.component_type)?.in_gross) {
          const prev = earliestLanded.get(c.master_product_id)
          if (!prev || c.effective_from < prev) earliestLanded.set(c.master_product_id, c.effective_from)
        }
        if (c.effective_from > today) continue
        const byKey = current.get(c.master_product_id) || new Map()
        const key = `${c.component_type}|${c.description || ''}`
        const prev = byKey.get(key)
        if (!prev || c.effective_from > prev.from) byKey.set(key, { type: c.component_type, amount: c.amount_pence, from: c.effective_from })
        current.set(c.master_product_id, byKey)
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
          let landed: number | null = null
          let otherUnit = 0
          let perOrder = 0
          const activeTypes: string[] = []
          current.get(p.id)?.forEach((v) => {
            const t = typeByCode.get(v.type)
            activeTypes.push(v.type)
            if (t?.in_gross) landed = (landed ?? 0) + v.amount
            else if (t?.basis === 'per_order') perOrder += v.amount
            else otherUnit += v.amount
          })
          const firstLanded = earliestLanded.get(p.id) || null
          return {
            id: p.id,
            sku: p.standard_sku,
            name: p.name,
            landedPence: landed,
            otherUnitPence: otherUnit,
            perOrderPence: perOrder,
            futureCostFrom: landed === null && firstLanded && firstLanded > today ? firstLanded : null,
            doubleCount: hasDoubleCountRisk(activeTypes),
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

  const needsAttention = (r: ProductCosts) => r.landedPence === null || r.doubleCount || r.ordersNoCost > 0 || r.ordersNoShipping > 0
  const problemCount = rows.filter(needsAttention).length
  const shown = rows
    .filter((r) => !onlyProblems || needsAttention(r))
    // Biggest problems first: most orders missing a cost, then SKU
    .sort((a, b) => b.ordersNoCost - a.ordersNoCost || b.ordersNoShipping - a.ordersNoShipping || a.sku.localeCompare(b.sku))

  function costAdvice(r: ProductCosts) {
    if (r.ordersNoCost === 0) return null
    // A cost exists but starts after some orders → it needs backdating, not adding
    if (r.landedPence !== null || r.futureCostFrom) {
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
        Add costs one product at a time with <strong>Edit costs</strong>, or many at once with{' '}
        <Link href="/cost-import" style={{ color: lime, fontWeight: 700 }}>Cost Import</Link>.
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
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '860px' }}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Landed cost</th>
                  <th style={thStyle}>Other per unit</th>
                  <th style={thStyle}>Per order</th>
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
                      <td style={{ ...tdStyle, color: r.landedPence === null ? red : text }}>
                        {r.landedPence !== null ? pounds(r.landedPence) : r.futureCostFrom ? `Starts ${r.futureCostFrom}` : 'Missing'}
                      </td>
                      <td style={{ ...tdStyle, color: r.otherUnitPence ? text : dim }}>{r.otherUnitPence ? pounds(r.otherUnitPence) : '—'}</td>
                      <td style={{ ...tdStyle, color: r.perOrderPence ? text : dim }}>{r.perOrderPence ? pounds(r.perOrderPence) : '—'}</td>
                      <td style={{ ...tdStyle, color: r.shippingRules ? text : dim }}>{r.shippingRules || '—'}</td>
                      <td style={{ ...tdStyle, fontSize: '13px' }}>
                        {advice && <div style={{ color: red }}>{advice}</div>}
                        {r.doubleCount && <div style={{ color: red }}>All-in landed cost AND product cost / freight / duty in effect: possible double count</div>}
                        {r.ordersNoShipping > 0 && (
                          <div style={{ color: amber }}>{r.ordersNoShipping} order line(s) with £0 shipping: add a shipping rule for that quantity</div>
                        )}
                        {!advice && r.landedPence === null && <div style={{ color: red }}>No landed / product cost yet</div>}
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
