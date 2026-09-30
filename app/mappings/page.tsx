'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadStores, Store } from '@/lib/stores'

type Listing = {
  id: string
  store_id: string
  platform_sku: string
  units_per_sale: number
  stores: { name: string } | null
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
        .select('id, standard_sku, name, platform_listings(id, store_id, platform_sku, units_per_sale, stores(name))')
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

  const thStyle = { padding: '6px', textAlign: 'left' as const, borderBottom: '1px solid #ddd', fontSize: '13px', color: '#666' }
  const tdStyle = { padding: '6px', fontSize: '14px' }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '1000px' }}>
      <h1>SKU Mapping by Channel</h1>
      <p style={{ color: '#666', fontSize: '14px' }}>
        Each product below can have one listing per store. If the same product was auto-created as separate entries during import,
        use the "Move to" dropdown when editing a listing to merge it into the correct product.
      </p>
      {status && <p style={{ color: '#2563eb' }}>{status}</p>}

      <section style={{ marginTop: '1.5rem', padding: '1rem', background: '#f5f5f5', borderRadius: '6px' }}>
        <h3 style={{ marginTop: 0 }}>Create New Product</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input placeholder="Standard SKU" value={newSku} onChange={(e) => setNewSku(e.target.value)} style={{ padding: '6px', width: '160px' }} />
          <input placeholder="Product Name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ padding: '6px', width: '220px' }} />
          <button onClick={createProduct} style={{ padding: '6px 12px' }}>Create</button>
        </div>
      </section>

      {products.map((product) => (
        <section key={product.id} style={{ marginTop: '2rem', borderTop: '2px solid #eee', paddingTop: '1rem' }}>
          {editingProductId === product.id ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '0.5rem' }}>
              <input value={editProductSku} onChange={(e) => setEditProductSku(e.target.value)} style={{ padding: '4px', width: '140px' }} />
              <input value={editProductName} onChange={(e) => setEditProductName(e.target.value)} style={{ padding: '4px', width: '220px' }} />
              <button onClick={() => saveProductDetails(product.id)}>Save</button>
              <button onClick={() => setEditingProductId(null)}>Cancel</button>
            </div>
          ) : (
            <h3>
              {product.name} <span style={{ color: '#888', fontWeight: 'normal' }}>({product.standard_sku})</span>{' '}
              <button
                onClick={() => {
                  setEditingProductId(product.id)
                  setEditProductSku(product.standard_sku)
                  setEditProductName(product.name)
                }}
                style={{ fontSize: '12px', color: '#2563eb', border: 'none', background: 'none', cursor: 'pointer' }}
              >
                Edit
              </button>
              {product.platform_listings.length === 0 && (
                <button
                  onClick={() => deleteProduct(product.id, product.platform_listings.length)}
                  style={{ fontSize: '12px', color: '#dc2626', border: 'none', background: 'none', cursor: 'pointer', marginLeft: '8px' }}
                >
                  Delete empty product
                </button>
              )}
            </h3>
          )}

          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thStyle}>Store</th>
                <th style={thStyle}>Platform SKU</th>
                <th style={thStyle}>Units per Sale</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {product.platform_listings.map((listing) =>
                editingListingId === listing.id ? (
                  <tr key={listing.id} style={{ background: '#fafafa' }}>
                    <td style={tdStyle}>
                      <select value={editStoreId} onChange={(e) => setEditStoreId(e.target.value)} style={{ padding: '4px' }}>
                        {stores.map((st) => (
                          <option key={st.id} value={st.id}>{st.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <input value={editSku} onChange={(e) => setEditSku(e.target.value)} style={{ padding: '4px', width: '120px' }} />
                    </td>
                    <td style={tdStyle}>
                      <input value={editUnits} onChange={(e) => setEditUnits(e.target.value)} style={{ padding: '4px', width: '50px' }} />
                    </td>
                    <td style={tdStyle}>
                      <select value={editProductId} onChange={(e) => setEditProductId(e.target.value)} style={{ padding: '4px', marginRight: '8px' }}>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>Move to: {p.name} ({p.standard_sku})</option>
                        ))}
                      </select>
                      <button onClick={() => saveListingEdit(listing.id)} style={{ marginRight: '6px' }}>Save</button>
                      <button onClick={() => setEditingListingId(null)}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={listing.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>{listing.stores?.name}</td>
                    <td style={tdStyle}>{listing.platform_sku}</td>
                    <td style={tdStyle}>{listing.units_per_sale}</td>
                    <td style={tdStyle}>
                      <button onClick={() => startEditListing(listing, product.id)} style={{ marginRight: '10px', color: '#2563eb', border: 'none', background: 'none', cursor: 'pointer' }}>
                        Edit
                      </button>
                      <button onClick={() => deleteListing(listing.id)} style={{ color: '#dc2626', border: 'none', background: 'none', cursor: 'pointer' }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>

          {addingToProduct === product.id ? (
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select value={addStoreId} onChange={(e) => setAddStoreId(e.target.value)} style={{ padding: '6px' }}>
                <option value="">Select store...</option>
                {stores.map((st) => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
              <input placeholder="Platform SKU" value={addSku} onChange={(e) => setAddSku(e.target.value)} style={{ padding: '6px', width: '140px' }} />
              <input placeholder="Units/sale" value={addUnits} onChange={(e) => setAddUnits(e.target.value)} style={{ padding: '6px', width: '70px' }} />
              <button onClick={() => saveNewListing(product.id)}>Save</button>
              <button onClick={() => setAddingToProduct(null)}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => startAddListing(product.id)} style={{ marginTop: '0.75rem', padding: '4px 10px', fontSize: '13px' }}>
              + Add store listing
            </button>
          )}
        </section>
      ))}
    </div>
  )
}
