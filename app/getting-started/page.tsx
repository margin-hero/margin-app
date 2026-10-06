'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadCostTypes } from '@/lib/costTypes'
import { lime, green, muted, dim, text, bg, border, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, radius } from '@/lib/theme'

type Step = {
  title: string
  body: string
  href: string
  action: string
  done: boolean
  detail?: string // e.g. "3 of 5 products"
  optional?: boolean
}

// How many rows a table has (RLS: only this tenant's)
async function countOf(table: string): Promise<number> {
  const { count } = await supabase.from(table).select('id', { count: 'exact', head: true })
  return count ?? 0
}

// The set-up steps in order, each ticked off from the tenant's own data
export default function GettingStartedPage() {
  const [steps, setSteps] = useState<Step[] | null>(null)

  useEffect(() => {
    async function load() {
      const [stores, couriers, profiles, orderLines, overheads, costTypes, { data: products }] = await Promise.all([
        countOf('stores'),
        countOf('courier_services'),
        countOf('shipping_profiles'),
        countOf('order_line_items'),
        countOf('overheads'),
        loadCostTypes(),
        fetchAll((from, to) =>
          supabase.from('master_products').select('id, platform_listings(id), cogs_components(component_type)').order('id').range(from, to)
        ),
      ])
      const landed = new Set(costTypes.filter((t) => t.in_gross).map((t) => t.code))
      const all = (products as any[]) || []
      const mapped = all.filter((p) => p.platform_listings.length > 0).length
      const costed = all.filter((p) => p.cogs_components.some((c: { component_type: string }) => landed.has(c.component_type))).length

      setSteps([
        {
          title: 'Add your stores',
          body: 'One for each shop you sell through, e.g. Amazon UK, two eBay stores, your Shopify site. Each has its own VAT setting.',
          href: '/stores', action: 'Stores', done: stores > 0, detail: stores ? `${stores} store(s)` : undefined,
        },
        {
          title: 'Add your couriers and prices',
          body: 'Each courier service you use (e.g. Evri Medium parcel) and what it costs. Skip if every channel buys your labels for you.',
          href: '/couriers', action: 'Couriers', done: couriers > 0, detail: couriers ? `${couriers} service(s)` : undefined,
        },
        {
          title: 'Create shipping profiles',
          body: 'How a type of product ships at each quantity, e.g. 1–2 units = 1 × Evri Medium. Products then just pick a profile.',
          href: '/shipping-profiles', action: 'Shipping Profiles', done: profiles > 0, detail: profiles ? `${profiles} profile(s)` : undefined,
        },
        {
          title: 'Add your products and their store SKUs',
          body: 'Add a product, then on its page add the SKU each store uses for it and choose its shipping profile. For many at once, use Catalog Import.',
          href: '/products', action: 'Products', done: all.length > 0 && mapped === all.length,
          detail: all.length ? `${mapped} of ${all.length} product(s) have store SKUs` : undefined,
        },
        {
          title: 'Add product costs',
          body: 'At least the landed cost of each product (what it costs you to get it in). Without it, margins look far too good. For many at once, use Cost Import.',
          href: '/costs', action: 'Cost Check', done: all.length > 0 && costed === all.length,
          detail: all.length ? `${costed} of ${all.length} product(s) have a landed cost` : undefined,
        },
        {
          title: 'Import your sales',
          body: 'Upload a sales or settlement report from any channel on the Import menu. Re-uploading the same report is safe: nothing is counted twice.',
          href: '/amazon-import', action: 'Import', done: orderLines > 0, detail: orderLines ? `${orderLines.toLocaleString('en-GB')} order line(s)` : undefined,
        },
        {
          title: 'Add overheads',
          body: 'Rent, wages, software and other running costs, so you can see profit after overheads.',
          href: '/overheads', action: 'Overheads', done: overheads > 0, optional: true,
        },
      ])
    }
    load()
  }, [])

  const required = steps?.filter((st) => !st.optional) ?? []
  const doneCount = required.filter((st) => st.done).length
  const nextIndex = steps?.findIndex((st) => !st.done && !st.optional) ?? -1

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Getting started</h1>
      <p style={pageIntro}>
        Set Margin Hero up in this order and every margin is complete from your first import. Each step ticks itself off as you go.
      </p>

      {!steps ? (
        <p style={{ color: muted, marginTop: '20px' }}>Checking...</p>
      ) : (
        <>
          <p style={{ fontSize: '15px', fontWeight: 700, color: doneCount === required.length ? green : text, margin: '20px 0 0' }}>
            {doneCount === required.length ? 'All set up ✓' : `${doneCount} of ${required.length} steps done`}
          </p>
          {steps.map((st, i) => {
            const isNext = i === nextIndex
            return (
              <div key={st.title} style={{ ...cardStyle, display: 'flex', gap: '18px', alignItems: 'flex-start', borderColor: isNext ? lime : border, marginTop: '14px' }}>
                <span style={{
                  flexShrink: 0, width: '34px', height: '34px', borderRadius: radius, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: '15px', background: st.done ? green : isNext ? lime : 'transparent', color: st.done || isNext ? bg : muted,
                  border: st.done || isNext ? 'none' : `1px solid ${border}`,
                }}>
                  {st.done ? '✓' : i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '17px', fontWeight: 800, margin: '0 0 4px', color: st.done ? muted : text }}>
                    {st.title}{st.optional && <span style={{ color: dim, fontWeight: 600, fontSize: '13px' }}> · optional</span>}
                  </p>
                  <p style={{ fontSize: '14px', color: muted, margin: 0, lineHeight: 1.5 }}>{st.body}</p>
                  {st.detail && <p style={{ fontSize: '13px', color: st.done ? green : text, margin: '6px 0 0', fontWeight: 600 }}>{st.detail}</p>}
                </div>
                <Link href={st.href} style={{ flexShrink: 0, color: isNext ? lime : muted, fontWeight: 800, fontSize: '14px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  {st.action} →
                </Link>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
