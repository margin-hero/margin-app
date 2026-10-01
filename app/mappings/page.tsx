'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadStores, Store, storeLabel } from '@/lib/stores'
import Link from 'next/link'
import { lime, red, muted, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, inputStyle, primaryButton, linkButton } from '@/lib/theme'

type Listing = {
  id: string
  store_id: string
  platform_sku: string
  units_per_sale: number
  stores: { name: string; platforms: { name: string } | null } | null
}

type Product = {
  id: string
  standard_sku: string
  name: string
  platform_listings: Listing[]
}

export default function MappingsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')

  // New product form
  const [newSku, setNewSku] = useState('')
  const [newName, setNewName] = useState('')

  // Add-listing form, keyed by product id
  const [addingToProduct, setAddingToProduct] = useState<string | null>(null)
  const [addStoreId, setAddStoreId] = useState('')
  const [addSku, setAddSku] = useState('')
  const [addUnits, setAddUnits] = useState('1')

  // Editing an existing listing
  const [editingListingId, setEditingListingId] = useState<string | null>(null)
  const [editStoreId, setEditStoreId] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editUnits, setEditUnits] = useState('1')
  const [editProductId, setEditProductId] = useState('')

  async function loadAll() {
    const { data: productData } = await fetchAll((from, to) =>
      supabase
        .from('master_products')
        .select('id, standard_sku, name, platform_listings(id, store_id, platform_sku, units_per_sale, stores(name, platforms(name)))')
        .order('standard_sku')
        .order('id')
        .range(from, to)
    )
    setProducts((productData as any) || [])

    setStores(await loadStores())
  }

  useEffect(() => {
    loadAll()
  }, [])

  async function createProduct() {
    if (!newSku || !newName) {
      setStatus('Please enter both a SKU and a name.')
      return
    }
    const { data: tenant } = await supabase.from('tenants').select('id').eq('name', 'Test Store').single()
    const { error } = await supabase.from('master_products').insert({
      tenant_id: tenant?.id,
      standard_sku: newSku,
      name: newName,
    })
    if (error) {
      setStatus(`Error creating product: ${error.message}`)
      return
    }
    setNewSku('')
    setNewName('')
    setStatus('Product created.')
    loadAll()
  }

  function startAddListing(productId: string) {
    setAddingToProduct(productId)
    setAddStoreId('')
    setAddSku('')
    setAddUnits('1')
  }

  async function saveNewListing(productId: string) {
    if (!addStoreId || !addSku) {
      setStatus('Please choose a store and enter a SKU.')
      return
    }
    const { error } = await supabase.from('platform_listings').insert({
      master_product_id: productId,
      store_id: addStoreId,
      platform_id: stores.find((st) => st.id === addStoreId)?.platform_id,
      platform_sku: addSku,
      units_per_sale: parseInt(addUnits) || 1,
    })
    if (error) {
      setStatus(`Error adding listing: ${error.message}`)
      return
    }
    setAddingToProduct(null)
    setStatus('Listing added.')
    loadAll()
  }

  function startEditListing(listing: Listing, currentProductId: string) {
    setEditingListingId(listing.id)
    setEditStoreId(listing.store_id)
    setEditSku(listing.platform_sku)
    setEditUnits(listing.units_per_sale.toString())
    setEditProductId(currentProductId)
  }

  async function saveListingEdit(listingId: string) {
    const { error } = await supabase
      .from('platform_listings')
      .update({
        store_id: editStoreId,
        platform_id: stores.find((st) => st.id === editStoreId)?.platform_id,
        platform_sku: editSku,
        units_per_sale: parseInt(editUnits) || 1,
        master_product_id: editProductId,
      })
      .eq('id', listingId)
    if (error) {
      setStatus(`Error saving: ${error.message}`)
      return
    }
    setEditingListingId(null)
    setStatus('Listing updated.')
    loadAll()
  }

  async function deleteListing(listingId: string) {
    await supabase.from('platform_listings').delete().eq('id', listingId)
    setStatus('Listing removed.')
    loadAll()
  }

  async function deleteProduct(productId: string, listingCount: number) {
    if (listingCount > 0) {
      setStatus('This product still has channel listings — move or delete those first before removing the product.')
      return
    }
    const { error } = await supabase.from('master_products').delete().eq('id', productId)
    if (error) {
      setStatus(`Error deleting product: ${error.message} (it may still have cost or shipping data attached — remove those on its edit page first.)`)
      return
    }
    setStatus('Product deleted.')
    loadAll()
  }

  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [editProductSku, setEditProductSku] = useState('')
  const [editProductName, setEditProductName] = useState('')

  async function saveProductDetails(productId: string) {
    if (!editProductSku || !editProductName) {
      setStatus('Please enter both a SKU and a name.')
      return
    }
    const { error } = await supabase
      .from('master_products')
      .update({ standard_sku: editProductSku, name: editProductName })
      .eq('id', productId)
    if (error) {
      setStatus(`Error updating product: ${error.message}`)
      return
    }
    setEditingProductId(null)
    setStatus('Product details updated.')
    loadAll()
  }

  const cancelButton: React.CSSProperties = { ...linkButton, color: muted }
  const deleteButton: React.CSSProperties = { ...linkButton, color: red }
  const q = search.trim().toLowerCase()
  const shownProducts = products.filter(
    (p) => !q || p.standard_sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.platform_listings.some((l) => l.platform_sku.toLowerCase().includes(q))
  )

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Mappings</h1>
      <p style={pageIntro}>
        Which SKU each store uses for each of your products. If the same product was auto-created as separate entries during import,
        edit a listing and use &ldquo;Move to&rdquo; to merge it into the correct product. To map lots at once, use{' '}
        <Link href="/catalog-import" style={{ color: lime, fontWeight: 700 }}>Catalog Import</Link>.
      </p>
      {status && <p style={{ color: lime, fontSize: '14px', fontWeight: 600, marginTop: '16px' }}>{status}</p>}

      <section style={cardStyle}>
        <p style={cardTitle}>Create new product</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input placeholder="Standard SKU" value={newSku} onChange={(e) => setNewSku(e.target.value)} style={{ ...inputStyle, width: '160px' }} />
          <input placeholder="Product Name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: '220px' }} />
          <button onClick={createProduct} style={primaryButton}>Create</button>
        </div>
      </section>

      <div style={{ marginTop: '20px' }}>
        <input placeholder="Search SKU, name or store SKU" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, width: '300px' }} />
        <span style={{ fontSize: '13px', color: muted, marginLeft: '12px' }}>{shownProducts.length} of {products.length} products</span>
      </div>

      {shownProducts.map((product) => (
        <section key={product.id} style={cardStyle}>
          {editingProductId === product.id ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '0.5rem' }}>
              <input value={editProductSku} onChange={(e) => setEditProductSku(e.target.value)} style={{ ...inputStyle, width: '140px' }} />
              <input value={editProductName} onChange={(e) => setEditProductName(e.target.value)} style={{ ...inputStyle, width: '220px' }} />
              <button onClick={() => saveProductDetails(product.id)} style={linkButton}>Save</button>
              <button onClick={() => setEditingProductId(null)} style={cancelButton}>Cancel</button>
            </div>
          ) : (
            <p style={{ fontSize: '17px', fontWeight: 800, color: text, margin: '0 0 12px' }}>
              {product.name} <span style={{ color: muted, fontWeight: 600, fontSize: '14px' }}>{product.standard_sku}</span>{' '}
              <button
                onClick={() => {
                  setEditingProductId(product.id)
                  setEditProductSku(product.standard_sku)
                  setEditProductName(product.name)
                }}
                style={linkButton}
              >
                Edit
              </button>
              {product.platform_listings.length === 0 && (
                <button
                  onClick={() => deleteProduct(product.id, product.platform_listings.length)}
                  style={deleteButton}
                >
                  Delete empty product
                </button>
              )}
            </p>
          )}

          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thStyle}>Store</th>
                <th style={thStyle}>Store SKU</th>
                <th style={thStyle}>Units per sale</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {product.platform_listings.map((listing) =>
                editingListingId === listing.id ? (
                  <tr key={listing.id} style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <td style={tdStyle}>
                      <select value={editStoreId} onChange={(e) => setEditStoreId(e.target.value)} style={inputStyle}>
                        {stores.map((st) => (
                          <option key={st.id} value={st.id}>{storeLabel(st)}</option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <input value={editSku} onChange={(e) => setEditSku(e.target.value)} style={{ ...inputStyle, width: '120px' }} />
                    </td>
                    <td style={tdStyle}>
                      <input value={editUnits} onChange={(e) => setEditUnits(e.target.value)} style={{ ...inputStyle, width: '50px' }} />
                    </td>
                    <td style={tdStyle}>
                      <select value={editProductId} onChange={(e) => setEditProductId(e.target.value)} style={{ ...inputStyle, marginRight: '8px' }}>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>Move to: {p.name} ({p.standard_sku})</option>
                        ))}
                      </select>
                      <button onClick={() => saveListingEdit(listing.id)} style={linkButton}>Save</button>
                      <button onClick={() => setEditingListingId(null)} style={cancelButton}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={listing.id}>
                    <td style={tdStyle}>{storeLabel(listing.stores)}</td>
                    <td style={tdStyle}>{listing.platform_sku}</td>
                    <td style={tdStyle}>{listing.units_per_sale}</td>
                    <td style={tdStyle}>
                      <button onClick={() => startEditListing(listing, product.id)} style={linkButton}>
                        Edit
                      </button>
                      <button onClick={() => deleteListing(listing.id)} style={deleteButton}>
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>

          {addingToProduct === product.id ? (
            <div style={{ marginTop: '14px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={addStoreId} onChange={(e) => setAddStoreId(e.target.value)} style={inputStyle}>
                <option value="">Select store...</option>
                {stores.map((st) => (
                  <option key={st.id} value={st.id}>{storeLabel(st)}</option>
                ))}
              </select>
              <input placeholder="Store SKU" value={addSku} onChange={(e) => setAddSku(e.target.value)} style={{ ...inputStyle, width: '140px' }} />
              <input placeholder="Units/sale" value={addUnits} onChange={(e) => setAddUnits(e.target.value)} style={{ ...inputStyle, width: '70px' }} />
              <button onClick={() => saveNewListing(product.id)} style={primaryButton}>Save</button>
              <button onClick={() => setAddingToProduct(null)} style={cancelButton}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => startAddListing(product.id)} style={{ ...linkButton, padding: 0, marginTop: '14px' }}>
              + Add store listing
            </button>
          )}
        </section>
      ))}
    </div>
  )
}
