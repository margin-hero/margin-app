'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { red, text, font } from '@/lib/theme'

// Shown above the dashboards when some orders have no product cost, because those
// orders show an inflated margin (often close to 100%) and skew every total.
export default function MissingCostsBanner() {
  const [summary, setSummary] = useState<{ lines: number; products: number } | null>(null)

  useEffect(() => {
    fetchAll((from, to) =>
      supabase.from('order_margins').select('master_product_id').eq('product_cost_pence', 0).order('order_line_item_id').range(from, to)
    ).then(({ data, error }) => {
      if (error || data.length === 0) return
      setSummary({ lines: data.length, products: new Set(data.map((r) => r.master_product_id)).size })
    })
  }, [])

  if (!summary) return null

  return (
    <div style={{ margin: 'clamp(20px, 3vw, 40px) clamp(20px, 3vw, 40px) 0', padding: '12px 18px', borderRadius: '14px', background: 'rgba(255,76,76,0.12)', border: `1px solid ${red}`, color: text, fontFamily: font, fontSize: '14px' }}>
      <strong style={{ color: red }}>Margins overstated:</strong> {summary.lines} order line(s) across {summary.products} product(s) have no product cost on their sale date (no cost added yet, or the cost starts after the sale and needs backdating).{' '}
      <Link href="/costs" style={{ color: red, fontWeight: 700 }}>Fix in Cost Check →</Link>
    </div>
  )
}
