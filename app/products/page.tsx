'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadCostTypes } from '@/lib/costTypes'
import NextStep from '@/components/NextStep'
import { lime, red, amber, green, muted, dim, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, inputStyle, primaryButton, statusColor } from '@/lib/theme'

type Product = {
  id: string
  standard_sku: string
  name: string
  vat_rate: number
  platform_listings: { id: string }[]
  cogs_components: { component_type: string }[]
  product_shipping_profiles: { store_id: string | null; shipping_profile_id: string | null }[]
  shipping_rules: { id: string }[]
}

export default function ProductsPage() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [landedCodes, setLandedCodes] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')

  const [newSku, setNewSku] = useState('')
  const [newName, setNewName] = useState('')
  const [newVatRate, setNewVatRate] = useState('0.2')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data }, costTypes] = await Promise.all([
        fetchAll((from, to) =>
          supabase
            .from('master_products')
            .select('id, standard_sku, name, vat_rate, platform_listings(id), cogs_components(component_type), product_shipping_profiles(store_id, shipping_profile_id), shipping_rules(id)')
            .order('standard_sku')
            .order('id')
            .range(from, to)
        ),
        loadCostTypes(),
      ])
      setProducts((data as any) || [])
      setLandedCodes(new Set(costTypes.filter((t) => t.in_gross).map((t) => t.code)))
      setLoading(false)
    }
    load()
  }, [])

  async function createProduct() {
    if (!newSku.trim() || !newName.trim()) {
      setStatus('Please enter both a SKU and a name.')
      return
    }
    setCreating(true)
    const { data, error } = await supabase
      .from('master_products')
      // tenant_id is filled in by the database (the logged-in user's tenant)
      .insert({ standard_sku: newSku.trim(), name: newName.trim(), vat_rate: parseFloat(newVatRate) })
      .select('id')
      .single()
    setCreating(false)
    if (error || !data) {
      setStatus(`Error adding product: ${error?.message || 'unknown error'}`)
      return
    }
    // Straight on to the product's page to add its store SKUs, costs and shipping
    router.push(`/products/${data.id}?new=1`)
  }

  const q = search.trim().toLowerCase()
  const shown = products.filter((p) => !q || p.standard_sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))

  const tick = (ok: boolean, okText: string, missingText: string, missingColor = red) => (
    <span style={{ color: ok ? green : missingColor, fontWeight: 600 }}>{ok ? `✓ ${okText}` : missingText}</span>
  )

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Products</h1>
      <p style={pageIntro}>
        Your products. Open one to set up everything about it in order: its store SKUs, costs and shipping.
        To add many at once, use <Link href="/catalog-import" style={{ color: lime, fontWeight: 700 }}>Catalog Import</Link> and{' '}
        <Link href="/cost-import" style={{ color: lime, fontWeight: 700 }}>Cost Import</Link>.
      </p>

      <section style={cardStyle}>
        <p style={cardTitle}>Add a product</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Your SKU" value={newSku} onChange={(e) => setNewSku(e.target.value)} style={{ ...inputStyle, width: '160px' }} />
          <input placeholder="Product name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: '260px' }} />
          <select value={newVatRate} onChange={(e) => setNewVatRate(e.target.value)} style={inputStyle} aria-label="VAT rate on sales">
            <option value="0.2">20% VAT (standard)</option>
            <option value="0.05">5% VAT (reduced)</option>
            <option value="0">0% VAT (zero-rated)</option>
          </select>
          <button onClick={createProduct} disabled={creating} style={{ ...primaryButton, opacity: creating ? 0.6 : 1 }}>
            {creating ? 'Adding...' : 'Add product'}
          </button>
        </div>
        <p style={{ color: muted, fontSize: '13px', margin: '10px 0 0' }}>
          Use your own SKU (the one you&apos;d recognise). Each store&apos;s own SKU for it is added on the next screen.
        </p>
        {status && <p style={{ color: statusColor(status), fontSize: '14px', fontWeight: 600, margin: '10px 0 0' }}>{status}</p>}
      </section>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <input placeholder="Search SKU or name" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, width: '260px' }} />
          <span style={{ fontSize: '13px', color: muted }}>{loading ? '' : `${shown.length} of ${products.length} products`}</span>
        </div>
        {loading ? (
          <p style={{ color: muted, fontSize: '14px', margin: 0 }}>Loading...</p>
        ) : shown.length === 0 ? (
          <p style={{ color: muted, fontSize: '14px', margin: 0 }}>{products.length ? 'No products match that search.' : 'No products yet: add your first one above.'}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '760px' }}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Store SKUs</th>
                  <th style={thStyle}>Landed cost</th>
                  <th style={thStyle}>Shipping</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const listings = p.platform_listings.length
                  const hasLanded = p.cogs_components.some((c) => landedCodes.has(c.component_type))
                  const hasShipping = p.product_shipping_profiles.some((a) => a.store_id === null && a.shipping_profile_id) || p.shipping_rules.length > 0
                  return (
                    <tr key={p.id}>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{p.standard_sku}</td>
                      <td style={tdStyle}>{p.name}</td>
                      <td style={{ ...tdStyle, fontSize: '13px' }}>{tick(listings > 0, `${listings} store${listings === 1 ? '' : 's'}`, 'None yet', amber)}</td>
                      <td style={{ ...tdStyle, fontSize: '13px' }}>{tick(hasLanded, 'Added', 'Missing')}</td>
                      <td style={{ ...tdStyle, fontSize: '13px' }}>{hasShipping ? tick(true, 'Set', '') : <span style={{ color: dim }}>Not set</span>}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <Link href={`/products/${p.id}`} style={{ color: lime, textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}>Open →</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NextStep href="/getting-started" label="Getting started checklist" text="Once your products have their store SKUs and costs, import a sales report from any channel on the Import menu." />
    </div>
  )
}
