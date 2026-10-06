'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { Store, storeLabel, usesSkuIds, skuIdChannel } from '@/lib/stores'
import { red, amber, muted, dim, thStyle, tdStyle, inputStyle, primaryButton, linkButton } from '@/lib/theme'

export type Listing = {
  id: string
  store_id: string
  platform_sku: string
  units_per_sale: number
  stores: { name: string; platforms: { name: string } | null } | null
}

export type ChannelSkuId = { store_id: string; sku_id: string; seller_sku: string }

// Channel SKU IDs per store, for channels whose reports use their own ID instead of your SKU (TikTok, Temu)
export async function loadChannelSkuIds(): Promise<ChannelSkuId[]> {
  const { data } = await fetchAll((from, to) =>
    supabase.from('channel_sku_ids').select('store_id, sku_id, seller_sku').order('store_id').order('sku_id').range(from, to)
  )
  return data || []
}

// One product's store SKUs: which stores sell it, under which SKU, and how many units one sale is.
// Used on the product page and, once per product, on the Store SKUs page.
export default function StoreListings({
  productId,
  listings,
  stores,
  allProducts,
  skuIds,
  onChanged,
}: {
  productId: string
  listings: Listing[]
  stores: Store[]
  allProducts: { id: string; name: string; standard_sku: string }[] // for "Move to" (merging duplicates)
  skuIds: ChannelSkuId[]
  onChanged: (message: string) => void // reloads the page's data and shows the message
}) {
  const [adding, setAdding] = useState(false)
  const [addStoreId, setAddStoreId] = useState('')
  const [addSku, setAddSku] = useState('')
  const [addUnits, setAddUnits] = useState('1')
  const [addSkuId, setAddSkuId] = useState('')

  const [editingListingId, setEditingListingId] = useState<string | null>(null)
  const [editStoreId, setEditStoreId] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editUnits, setEditUnits] = useState('1')
  const [editProductId, setEditProductId] = useState('')
  const [editSkuId, setEditSkuId] = useState('')

  const idsFor = (storeId: string, sellerSku: string) =>
    skuIds.filter((c) => c.store_id === storeId && c.seller_sku === sellerSku).map((c) => c.sku_id)

  const idLabel = (storeId: string) => `${skuIdChannel(stores.find((st) => st.id === storeId)) ?? 'Channel'} SKU ID`

  // Returns an error message, or null if this channel SKU ID can be used for this store SKU
  function checkSkuId(storeId: string, skuId: string, sellerSku: string): string | null {
    if (!/^\d+$/.test(skuId)) return `The ${idLabel(storeId)} is the long number from the channel's seller centre (digits only).`
    const taken = skuIds.find((c) => c.store_id === storeId && c.sku_id === skuId && c.seller_sku !== sellerSku)
    return taken ? `${idLabel(storeId)} ${skuId} already belongs to store SKU "${taken.seller_sku}" in this shop.` : null
  }

  // One channel SKU ID per listing: replace whatever was stored for the old store SKU
  async function saveSkuId(store: Store, skuId: string, sellerSku: string, previousSellerSku: string) {
    await supabase.from('channel_sku_ids').delete().eq('store_id', store.id).in('seller_sku', [sellerSku, previousSellerSku])
    return supabase.from('channel_sku_ids').upsert(
      { tenant_id: store.tenant_id, store_id: store.id, sku_id: skuId, seller_sku: sellerSku },
      { onConflict: 'store_id,sku_id' }
    )
  }

  function startAdd() {
    setAdding(true)
    setAddStoreId('')
    setAddSku('')
    setAddUnits('1')
    setAddSkuId('')
  }

  async function saveNewListing() {
    if (!addStoreId || !addSku) {
      onChanged('Please choose a store and enter a SKU.')
      return
    }
    const addStore = stores.find((st) => st.id === addStoreId)
    const skuId = addSkuId.trim()
    const knownIds = idsFor(addStoreId, addSku.trim())
    if (usesSkuIds(addStore) && !skuId && knownIds.length === 0) {
      onChanged(`Listings in this store need the ${idLabel(addStoreId)}, or orders for this product won't match.`)
      return
    }
    if (usesSkuIds(addStore) && skuId) {
      const problem = checkSkuId(addStoreId, skuId, addSku.trim())
      if (problem) {
        onChanged(problem)
        return
      }
    }
    const { error } = await supabase.from('platform_listings').insert({
      master_product_id: productId,
      store_id: addStoreId,
      platform_id: addStore?.platform_id,
      platform_sku: addSku,
      units_per_sale: parseInt(addUnits) || 1,
    })
    if (error) {
      onChanged(`Error adding store SKU: ${error.message}`)
      return
    }
    if (addStore && usesSkuIds(addStore) && skuId) {
      const { error: idError } = await saveSkuId(addStore, skuId, addSku.trim(), addSku.trim())
      if (idError) {
        setAdding(false)
        onChanged(`Store SKU added, but saving the ${idLabel(addStoreId)} failed: ${idError.message}`)
        return
      }
    }
    setAdding(false)
    onChanged('Store SKU added.')
  }

  function startEdit(listing: Listing) {
    setEditingListingId(listing.id)
    setEditStoreId(listing.store_id)
    setEditSku(listing.platform_sku)
    setEditUnits(listing.units_per_sale.toString())
    setEditProductId(productId)
    setEditSkuId(idsFor(listing.store_id, listing.platform_sku)[0] || '')
  }

  async function saveEdit(listingId: string) {
    const original = listings.find((l) => l.id === listingId)
    const editStore = stores.find((st) => st.id === editStoreId)
    const skuId = editSkuId.trim()
    const previousSku = original && original.store_id === editStoreId ? original.platform_sku : editSku
    if (usesSkuIds(editStore)) {
      if (!skuId) {
        onChanged(`Listings in this store need the ${idLabel(editStoreId)}, or orders for this product won't match.`)
        return
      }
      // Fine if the ID already belongs to this listing's old store SKU or its new one; a problem only if both checks fail
      const problem = checkSkuId(editStoreId, skuId, previousSku) && checkSkuId(editStoreId, skuId, editSku)
      if (problem) {
        onChanged(problem)
        return
      }
    }
    const { error } = await supabase
      .from('platform_listings')
      .update({
        store_id: editStoreId,
        platform_id: editStore?.platform_id,
        platform_sku: editSku,
        units_per_sale: parseInt(editUnits) || 1,
        master_product_id: editProductId,
      })
      .eq('id', listingId)
    if (error) {
      onChanged(`Error saving: ${error.message}`)
      return
    }
    if (editStore && usesSkuIds(editStore)) {
      const { error: idError } = await saveSkuId(editStore, skuId, editSku, previousSku)
      if (idError) {
        onChanged(`Store SKU updated, but saving the ${idLabel(editStoreId)} failed: ${idError.message}`)
        return
      }
    }
    setEditingListingId(null)
    onChanged(editProductId !== productId ? 'Store SKU moved to the other product.' : 'Store SKU updated.')
  }

  async function deleteListing(listingId: string) {
    const { error } = await supabase.from('platform_listings').delete().eq('id', listingId)
    onChanged(error ? `Error removing store SKU: ${error.message}` : 'Store SKU removed.')
  }

  const cancelButton: React.CSSProperties = { ...linkButton, color: muted }
  const deleteButton: React.CSSProperties = { ...linkButton, color: red }
  const hasSkuIds = stores.some(usesSkuIds)

  return (
    <>
      {listings.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thStyle}>Store</th>
                <th style={thStyle}>Store SKU</th>
                <th style={thStyle}>Units per sale</th>
                {hasSkuIds && <th style={thStyle}>Channel SKU ID</th>}
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) =>
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
                    {hasSkuIds && (
                      <td style={tdStyle}>
                        {usesSkuIds(stores.find((st) => st.id === editStoreId)) ? (
                          <input placeholder="Required" value={editSkuId} onChange={(e) => setEditSkuId(e.target.value)} style={{ ...inputStyle, width: '170px' }} />
                        ) : <span style={{ color: dim }}>—</span>}
                      </td>
                    )}
                    <td style={tdStyle}>
                      <select value={editProductId} onChange={(e) => setEditProductId(e.target.value)} style={{ ...inputStyle, marginRight: '8px' }}>
                        {allProducts.map((p) => (
                          <option key={p.id} value={p.id}>{p.id === productId ? 'Keep on this product' : `Move to: ${p.name} (${p.standard_sku})`}</option>
                        ))}
                      </select>
                      <button onClick={() => saveEdit(listing.id)} style={linkButton}>Save</button>
                      <button onClick={() => setEditingListingId(null)} style={cancelButton}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={listing.id}>
                    <td style={tdStyle}>{storeLabel(listing.stores)}</td>
                    <td style={tdStyle}>{listing.platform_sku}</td>
                    <td style={tdStyle}>{listing.units_per_sale}</td>
                    {hasSkuIds && (
                      <td style={tdStyle}>
                        {usesSkuIds(stores.find((st) => st.id === listing.store_id))
                          ? idsFor(listing.store_id, listing.platform_sku).join(', ') || <span style={{ color: amber, fontWeight: 700 }}>Missing: orders won&apos;t match</span>
                          : <span style={{ color: dim }}>—</span>}
                      </td>
                    )}
                    <td style={tdStyle}>
                      <button onClick={() => startEdit(listing)} style={linkButton}>Edit</button>
                      <button onClick={() => deleteListing(listing.id)} style={deleteButton}>Delete</button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <div style={{ marginTop: '14px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={addStoreId} onChange={(e) => setAddStoreId(e.target.value)} style={inputStyle}>
            <option value="">Select store...</option>
            {stores.map((st) => (
              <option key={st.id} value={st.id}>{storeLabel(st)}</option>
            ))}
          </select>
          <input placeholder="Store SKU" value={addSku} onChange={(e) => setAddSku(e.target.value)} style={{ ...inputStyle, width: '140px' }} />
          <input placeholder="Units/sale" value={addUnits} onChange={(e) => setAddUnits(e.target.value)} style={{ ...inputStyle, width: '70px' }} />
          {usesSkuIds(stores.find((st) => st.id === addStoreId)) && (
            idsFor(addStoreId, addSku.trim()).length > 0 ? (
              <span style={{ fontSize: '13px', color: muted }}>{idLabel(addStoreId)} {idsFor(addStoreId, addSku.trim()).join(', ')} already on file</span>
            ) : (
              <input placeholder={`${idLabel(addStoreId)} (required)`} value={addSkuId} onChange={(e) => setAddSkuId(e.target.value)} style={{ ...inputStyle, width: '210px' }} />
            )
          )}
          <button onClick={saveNewListing} style={primaryButton}>Save</button>
          <button onClick={() => setAdding(false)} style={cancelButton}>Cancel</button>
        </div>
      ) : (
        <button onClick={startAdd} style={{ ...linkButton, padding: 0, marginTop: listings.length ? '14px' : 0 }}>
          + Add store SKU
        </button>
      )}
    </>
  )
}
