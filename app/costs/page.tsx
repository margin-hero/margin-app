'use client'

import { ukDate } from '@/lib/format'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadCostTypes, hasDoubleCountRisk } from '@/lib/costTypes'
import { lime, amber, red, muted, dim, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, thStyle, tdStyle, linkButton } from '@/lib/theme'

type ProductCosts = {
  id: string
  sku: string
  name: string
  landedPence: number | null // current landed cost: all-in, or product cost + freight + duty (as entered, inc. VAT)
  otherUnitPence: number // current other per-unit costs combined
  perOrderPence: number // current per-order costs combined
  futureCostFrom: string | null // a landed cost exists but only starts in the future
  doubleCount: boolean // all-in landed cost AND its parts are both in effect
  shippingProfile: string | null // all-stores shipping profile name
  shippingRules: number
  ordersNoCost: number // order lines where product cost came out as £0
  earliestNoCost: string | null
  ordersNoShipping: number
  firstOrder: string | null // the product's earliest order, any store
  // Every cost (any type: landed, WEEE, packaging...) whose first entry starts after some of the
  // product's orders, so those orders don't include it. Backdating that first entry fixes them.
  lateCosts: LateCost[]
}

type LateCost = { rowId: string; label: string; from: string; ordersBefore: number }

const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`

export default function CostsPage() {
  const [rows, setRows] = useState<ProductCosts[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(true)
  const [reloadKey, setReloadKey] = useState(0) // bump to load again after a change
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const today = new Date().toISOString().slice(0, 10)
      const [costTypes, products, cogs, shipping, noCost, noShipping, profiles, assignments, orderDates] = await Promise.all([
        loadCostTypes(),
        fetchAll((from, to) => supabase.from('master_products').select('id, standard_sku, name').order('id').range(from, to)),
        fetchAll((from, to) =>
          supabase.from('cogs_components').select('id, master_product_id, component_type, description, amount_pence, effective_from').order('id').range(from, to)
        ),
        fetchAll((from, to) => supabase.from('shipping_rules').select('master_product_id').order('id').range(from, to)),
        fetchAll((from, to) =>
          supabase.from('order_margins').select('master_product_id, order_date').eq('product_cost_pence', 0).order('order_line_item_id').range(from, to)
        ),
        fetchAll((from, to) =>
          // 'missing' = no label cost, no rule and no profile covers this order (deliberate 'no shipping' isn't flagged)
          supabase.from('order_margins').select('master_product_id').eq('shipping_source', 'missing').order('order_line_item_id').range(from, to)
        ),
        supabase.from('shipping_profiles').select('id, name'),
        fetchAll((from, to) =>
          supabase.from('product_shipping_profiles').select('id, master_product_id, shipping_profile_id').is('store_id', null).order('id').range(from, to)
        ),
        // Every order line's date and product, to spot costs that start after some orders
        fetchAll((from, to) => supabase.from('order_line_items').select('id, order_date, platform_listings(master_product_id)').order('id').range(from, to)),
      ])
      const firstError = [products, cogs, shipping, noCost, noShipping, profiles, assignments, orderDates].find((r) => r.error)?.error
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
      // product -> (type|description) -> the first entry of that cost
      const firstRow = new Map<string, Map<string, { id: string; type: string; description: string | null; from: string }>>()
      for (const c of cogs.data) {
        if (typeByCode.get(c.component_type)?.in_gross) {
          const prev = earliestLanded.get(c.master_product_id)
          if (!prev || c.effective_from < prev) earliestLanded.set(c.master_product_id, c.effective_from)
        }
        const groups = firstRow.get(c.master_product_id) || new Map()
        const groupKey = `${c.component_type}|${c.description || ''}`
        const first = groups.get(groupKey)
        if (!first || c.effective_from < first.from) groups.set(groupKey, { id: c.id, type: c.component_type, description: c.description, from: c.effective_from })
        firstRow.set(c.master_product_id, groups)
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
      const profileNameById = new Map((profiles.data || []).map((p) => [p.id, p.name]))
      const profileOf = new Map(assignments.data.map((a) => [a.master_product_id, profileNameById.get(a.shipping_profile_id) || null]))
      // Each product's order dates
      const datesOf = new Map<string, string[]>()
      for (const o of orderDates.data as any[]) {
        const productId = o.platform_listings?.master_product_id
        if (!productId) continue
        const list = datesOf.get(productId) || []
        list.push(o.order_date)
        datesOf.set(productId, list)
      }
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
          const dates = datesOf.get(p.id) || []
          const firstOrder = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null
          const lateCosts: LateCost[] = []
          firstRow.get(p.id)?.forEach((row) => {
            const ordersBefore = dates.filter((d) => d < row.from).length
            if (ordersBefore === 0) return
            const typeLabel = typeByCode.get(row.type)?.label || row.type
            lateCosts.push({ rowId: row.id, label: row.description ? `${typeLabel} (${row.description})` : typeLabel, from: row.from, ordersBefore })
          })
          return {
            id: p.id,
            sku: p.standard_sku,
            name: p.name,
            landedPence: landed,
            otherUnitPence: otherUnit,
            perOrderPence: perOrder,
            futureCostFrom: landed === null && firstLanded && firstLanded > today ? firstLanded : null,
            doubleCount: hasDoubleCountRisk(activeTypes),
            shippingProfile: profileOf.get(p.id) || null,
            shippingRules: shippingCounts.get(p.id) || 0,
            ordersNoCost: noCostCounts.get(p.id) || 0,
            earliestNoCost: earliestNoCost.get(p.id) || null,
            ordersNoShipping: noShippingCounts.get(p.id) || 0,
            firstOrder,
            lateCosts,
          }
        })
      )
      setLoading(false)
    }
    load()
  }, [reloadKey])

  // Moves one cost's first entry back to the product's first order. This is a correction
  // (like Edit on the product page), so it changes past figures; nothing else is touched.
  async function backdate(r: ProductCosts, cost: LateCost) {
    if (!r.firstOrder) return
    if (!window.confirm(
      `Backdate ${r.sku}'s ${cost.label} to ${ukDate(r.firstOrder)}?\n\n` +
      `It will then apply to its ${cost.ordersBefore} earlier order line(s) too. ` +
      `Only do this if the cost was the same back then. If it was different (or didn't exist yet), leave it, or add the older amount on the product page instead.`
    )) return
    setBusyId(cost.rowId)
    const { error: updateError } = await supabase.from('cogs_components').update({ effective_from: r.firstOrder }).eq('id', cost.rowId)
    if (updateError) setError(`Couldn't backdate ${r.sku}: ${updateError.message}`)
    setBusyId(null)
    setReloadKey((k) => k + 1)
  }

  const needsAttention = (r: ProductCosts) =>
    r.landedPence === null || r.doubleCount || r.ordersNoCost > 0 || r.ordersNoShipping > 0 || r.lateCosts.length > 0
  const problemCount = rows.filter(needsAttention).length
  const shown = rows
    .filter((r) => !onlyProblems || needsAttention(r))
    // Biggest problems first: most orders missing a cost, then SKU
    .sort((a, b) => b.ordersNoCost - a.ordersNoCost || b.lateCosts.length - a.lateCosts.length || b.ordersNoShipping - a.ordersNoShipping || a.sku.localeCompare(b.sku))

  function costAdvice(r: ProductCosts) {
    if (r.ordersNoCost === 0) return null
    // A cost exists but starts after some orders → it needs backdating, not adding
    if (r.landedPence !== null || r.futureCostFrom) {
      return `${r.ordersNoCost} order line(s) have no landed cost because it starts after them (see below)`
    }
    return `${r.ordersNoCost} order line(s) have no product cost (showing inflated margin)`
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Cost Check</h1>
      <p style={pageIntro}>
        Every product&apos;s current costs in one place. A product with no cost price looks far more profitable than it is,
        so anything flagged here is making your margins look better than they really are. A cost only applies to orders on or
        after its &quot;effective from&quot; date, so a cost added after a sale needs backdating to cover it. Any cost (landed cost, WEEE,
        packaging...) that starts after some of a product&apos;s orders is listed in amber, with a Backdate link if it applied back then too.
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
                  <th style={thStyle}>Shipping</th>
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
                        {r.landedPence !== null ? pounds(r.landedPence) : r.futureCostFrom ? `Starts ${ukDate(r.futureCostFrom)}` : 'Missing'}
                      </td>
                      <td style={{ ...tdStyle, color: r.otherUnitPence ? text : dim }}>{r.otherUnitPence ? pounds(r.otherUnitPence) : '—'}</td>
                      <td style={{ ...tdStyle, color: r.perOrderPence ? text : dim }}>{r.perOrderPence ? pounds(r.perOrderPence) : '—'}</td>
                      <td style={{ ...tdStyle, color: r.shippingProfile || r.shippingRules ? text : dim, fontSize: '13px' }}>
                        {r.shippingProfile || (r.shippingRules ? '' : '—')}
                        {r.shippingRules > 0 && <div style={{ color: muted }}>{r.shippingRules} exact-price rule(s)</div>}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '13px' }}>
                        {advice && <div style={{ color: red }}>{advice}</div>}
                        {r.lateCosts.map((cost) => (
                          <div key={cost.rowId} style={{ color: amber, margin: '2px 0 4px' }}>
                            {cost.label} starts {ukDate(cost.from)}: {cost.ordersBefore} earlier order line(s) don&apos;t include it.{' '}
                            <button onClick={() => backdate(r, cost)} disabled={busyId === cost.rowId} style={{ ...linkButton, padding: 0, opacity: busyId === cost.rowId ? 0.6 : 1 }}>
                              {busyId === cost.rowId ? 'Backdating...' : `Backdate to ${ukDate(r.firstOrder)} →`}
                            </button>
                          </div>
                        ))}
                        {r.doubleCount && <div style={{ color: red }}>All-in landed cost AND product cost / freight / duty in effect: possible double count</div>}
                        {r.ordersNoShipping > 0 && (
                          <div style={{ color: amber }}>{r.ordersNoShipping} order line(s) with no shipping cost: assign a shipping profile that covers that quantity (or set &quot;No shipping cost&quot; for that store)</div>
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
          Costs are shown as entered (including VAT). Shipping is only flagged when nothing covers an order: no label cost from the channel, no exact-price rule and no shipping profile band.
        </p>
      </div>
    </div>
  )
}
