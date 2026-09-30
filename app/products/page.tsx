'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'

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
  const thStyle: React.CSSProperties = { padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500, fontSize: '13px', borderBottom: '0.5px solid #333' }
  const tdStyle: React.CSSProperties = { padding: '8px', color: '#eee', fontSize: '14px', borderBottom: '0.5px solid #2e2e2e' }

  return (
    <div style={{ background: '#1A1A1A', minHeight: '100vh' }}>
      <div style={pageStyle}>
        <span style={{ fontSize: '18px', fontWeight: 500 }}>Products</span>
        <p style={{ color: '#888', fontSize: '13px', marginTop: '4px' }}>Master products and their default VAT rate. Open a product to edit its costs.</p>

        <div style={cardStyle}>
          {loading ? (
            <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>Loading...</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Default VAT Rate</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>{p.standard_sku}</td>
                    <td style={tdStyle}>{p.name}</td>
                    <td style={tdStyle}>{(p.vat_rate * 100).toFixed(0)}%</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <Link href={`/products/${p.id}`} style={{ color: '#DCFF00', textDecoration: 'none', fontSize: '13px' }}>Edit costs →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
