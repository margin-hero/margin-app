'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadStores, Store, isTikTokStore } from '@/lib/stores'
import TikTokCatalogUpload from '@/components/TikTokCatalogUpload'
import StoreListings, { Listing, TikTokId, loadTikTokIds } from '@/components/StoreListings'
import NextStep from '@/components/NextStep'
import { lime, muted, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, inputStyle, statusColor } from '@/lib/theme'

type Product = {
  id: string
  standard_sku: string
  name: string
  platform_listings: Listing[]
}

// Every product's store SKUs on one page. The same editor is on each product's own page.
export default function StoreSkusPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [tiktokIds, setTiktokIds] = useState<TikTokId[]>([])
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')

  async function loadAll() {
    const [{ data: productData }, storeList, ids] = await Promise.all([
      fetchAll((from, to) =>
        supabase
          .from('master_products')
          .select('id, standard_sku, name, platform_listings(id, store_id, platform_sku, units_per_sale, stores(name, platforms(name)))')
          .order('standard_sku')
          .order('id')
          .range(from, to)
      ),
      loadStores(),
      loadTikTokIds(),
    ])
    setProducts((productData as any) || [])
    setStores(storeList)
    setTiktokIds(ids)
  }

  useEffect(() => {
    loadAll()
  }, [])

  function changed(message: string) {
    setStatus(message)
    loadAll()
  }

  const q = search.trim().toLowerCase()
  const shownProducts = products.filter(
    (p) => !q || p.standard_sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.platform_listings.some((l) => l.platform_sku.toLowerCase().includes(q))
  )

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Store SKUs</h1>
      <p style={pageIntro}>
        Which SKU each store uses for each of your products, all on one page (each product&apos;s own page has the same list for that product).
        Add new products on <Link href="/products" style={{ color: lime, fontWeight: 700 }}>Products</Link>; to map lots at once, use{' '}
        <Link href="/catalog-import" style={{ color: lime, fontWeight: 700 }}>Catalog Import</Link>.
        If the same product was auto-created twice during an import, edit a store SKU and use &ldquo;Move to&rdquo; to merge it into the right product.
      </p>
      {status && <p style={{ color: statusColor(status), fontSize: '14px', fontWeight: 600, marginTop: '16px' }}>{status}</p>}

      {stores.some(isTikTokStore) && <TikTokCatalogUpload onSaved={loadAll} />}

      <div style={{ marginTop: '20px' }}>
        <input placeholder="Search SKU, name or store SKU" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, width: '300px' }} />
        <span style={{ fontSize: '13px', color: muted, marginLeft: '12px' }}>{shownProducts.length} of {products.length} products</span>
      </div>

      {shownProducts.map((product) => (
        <section key={product.id} style={cardStyle}>
          <p style={{ fontSize: '17px', fontWeight: 800, color: text, margin: '0 0 12px' }}>
            <Link href={`/products/${product.id}`} style={{ color: text, textDecoration: 'none' }}>{product.name}</Link>{' '}
            <span style={{ color: muted, fontWeight: 600, fontSize: '14px' }}>{product.standard_sku}</span>{' '}
            <Link href={`/products/${product.id}`} style={{ color: lime, fontSize: '13px', fontWeight: 700, textDecoration: 'none', marginLeft: '6px' }}>Open product →</Link>
          </p>
          <StoreListings
            productId={product.id}
            listings={product.platform_listings}
            stores={stores}
            allProducts={products}
            tiktokIds={tiktokIds}
            onChanged={changed}
          />
        </section>
      ))}

      <NextStep href="/products" label="Back to Products" text="Each product's page has its store SKUs, costs and shipping in one place." />
    </div>
  )
}
