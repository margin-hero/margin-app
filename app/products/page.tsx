'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { lime, muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, thStyle, tdStyle, inputStyle } from '@/lib/theme'

type Product = {
  id: string
  standard_sku: string
  name: string
  vat_rate: number
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await fetchAll((from, to) =>
        supabase
          .from('master_products')
          .select('id, standard_sku, name, vat_rate')
          .order('standard_sku')
          .order('id')
          .range(from, to)
      )
      setProducts(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const q = search.trim().toLowerCase()
  const shown = products.filter((p) => !q || p.standard_sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Products</h1>
      <p style={pageIntro}>
        Your master products. Open one to edit its costs and shipping. To add many at once, use{' '}
        <Link href="/catalog-import" style={{ color: lime, fontWeight: 700 }}>Catalog Import</Link>; to see what&apos;s missing, use{' '}
        <Link href="/costs" style={{ color: lime, fontWeight: 700 }}>Costs</Link>.
      </p>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <input placeholder="Search SKU or name" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, width: '260px' }} />
          <span style={{ fontSize: '13px', color: muted }}>{loading ? '' : `${shown.length} of ${products.length} products`}</span>
        </div>
        {loading ? (
          <p style={{ color: muted, fontSize: '14px', margin: 0 }}>Loading...</p>
        ) : shown.length === 0 ? (
          <p style={{ color: muted, fontSize: '14px', margin: 0 }}>{products.length ? 'No products match that search.' : 'No products yet.'}</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thStyle}>SKU</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Default VAT rate</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{p.standard_sku}</td>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={tdStyle}>{(p.vat_rate * 100).toFixed(0)}%</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <Link href={`/products/${p.id}`} style={{ color: lime, textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}>Edit costs →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
