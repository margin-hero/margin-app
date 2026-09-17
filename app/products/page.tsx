'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Product = {
  id: string
  standard_sku: string
  name: string
  vat_rate: number
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('master_products')
        .select('id, standard_sku, name, vat_rate')
        .order('standard_sku')
      setProducts(data || [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Products</h1>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: '8px' }}>SKU</th>
            <th style={{ padding: '8px' }}>Name</th>
            <th style={{ padding: '8px' }}>Default VAT Rate</th>
            <th style={{ padding: '8px' }}></th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '8px' }}>{p.standard_sku}</td>
              <td style={{ padding: '8px' }}>{p.name}</td>
              <td style={{ padding: '8px' }}>{(p.vat_rate * 100).toFixed(0)}%</td>
              <td style={{ padding: '8px' }}>
                <Link href={`/products/${p.id}`} style={{ color: '#2563eb' }}>Edit costs →</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
