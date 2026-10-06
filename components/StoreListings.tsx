'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { Store, storeLabel, isTikTokStore } from '@/lib/stores'
import { red, amber, muted, dim, thStyle, tdStyle, inputStyle, primaryButton, linkButton } from '@/lib/theme'

export type Listing = {
  id: string
  store_id: string
  platform_sku: string
  units_per_sale: number
  stores: { name: string; platforms: { name: string } | null } | null
}

export type TikTokId = { store_id: string; sku_id: string; seller_sku: string }

// TikTok SKU IDs per TikTok store (TikTok reports use these instead of your SKU)
export async function loadTikTokIds(): Promise<TikTokId[]> {
  const { data } = await fetchAll((from, to) =>
    supabase.from('tiktok_sku_catalog').select('store_id, sku_id, seller_sku').order('store_id').order('sku_id').range(from, to)
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
  tiktokIds,
  onChanged,
}: {
  productId: string
  listings: Listing[]
  stores: Store[]
  allProducts: { id: string; name: string; standard_sku: string }[] // for "Move to" (merging duplicates)
  tiktokIds: TikTokId[]
  onChanged: (message: string) => void // reloads the page's data and shows the message
}) {
  const [adding, setAdding] = useState(false)
  const [addStoreId, setAddStoreId] = useState('')
  const [addSku, setAddSku] = useState('')
  const [addUnits, setAddUnits] = useState('1')
  const [addTikTokId, setAddTikTokId] = useState('')

  const [editingListingId, setEditingListingId] = useState<string | null>(null)
  const [editStoreId, setEditStoreId] = useState('')
  const [editSku, setEditSku] = useState('')
  const [editUnits, setEditUnits] = useState('1')
  const [editProductId, setEditProductId] = useState('')
  const [editTikTokId, setEditTikTokId] = useState('')

  const idsFor = (storeId: string, sellerSku: string) =>
    tiktokIds.filter((c) => c.store_id === storeId && c.seller_sku === sellerSku).map((c) => c.sku_id)

  // Returns an error message, or null if this TikTok SKU ID can be used for this store SKU
  function checkTikTokId(storeId: string, skuId: string, sellerSku: string): string | null {
    if (!/^\d+$/.test(skuId)) return 'The TikTok SKU ID is the long number from TikTok Seller Centre (digits only).'
    const taken = tiktokIds.find((c) => c.store_id === storeId && c.sku_id === skuId && c.seller_sku !== sellerSku)
    return taken ? `TikTok SKU ID ${skuId} already belongs to store SKU "${taken.seller_sku}" in this shop.` : null
  }

  // One TikTok SKU ID per listing: replace whatever was stored for the old store SKU
  async function saveTikTokId(store: Store, skuId: string, sellerSku: string, previousSellerSku: string) {
    await supabase.from('tiktok_sku_catalog').delete().eq('store_id', store.id).in('seller_sku', [sellerSku, previousSellerSku])
    return supabase.from('tiktok_sku_catalog').upsert(
      { tenant_id: store.tenant_id, store_id: store.id, sku_id: skuId, seller_sku: sellerSku },
      { onConflict: 'store_id,sku_id' }
    )
  }

  function startAdd() {
    setAdding(true)
    setAddStoreId('')
    setAddSku('')
    setAddUnits('1')
    setAddTikTokId('')
  }

  async function saveNewListing() {
    if (!addStoreId || !addSku) {
      onChanged('Please choose a store and enter a SKU.')
      return
    }
    const addStore = stores.find((st) => st.id === addStoreId)
    const tiktokId = addTikTokId.trim()
    const knownIds = idsFor(addStoreId, addSku.trim())
    if (isTikTokStore(addStore) && !tiktokId && knownIds.length === 0) {
      onChanged('TikTok listings need their TikTok SKU ID, or orders for this product won\'t match.')
      return
    }
    if (isTikTokStore(addStore) && tiktokId) {
      const problem = checkTikTokId(addStoreId, tiktokId, addSku.trim())
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
    if (addStore && isTikTokStore(addStore) && tiktokId) {
      const { error: idError } = await saveTikTokId(addStore, tiktokId, addSku.trim(), addSku.trim())
      if (idError) {
        setAdding(false)
        onChanged(`Store SKU added, but saving the TikTok SKU ID failed: ${idError.message}`)
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
    setEditTikTokId(idsFor(listing.store_id, listing.platform_sku)[0] || '')
  }

  async function saveEdit(listingId: string) {
    const original = listings.find((l) => l.id === listingId)
    const editStore = stores.find((st) => st.id === editStoreId)
    const tiktokId = editTikTokId.trim()
    const previousSku = original && original.store_id === editStoreId ? original.platform_sku : editSku
    if (isTikTokStore(editStore)) {
      if (!tiktokId) {
        onChanged('TikTok listings need their TikTok SKU ID, or orders for this product won\'t match.')
        return
      }
      // Fine if the ID already belongs to this listing's old store SKU or its new one; a problem only if both checks fail
      const problem = checkTikTokId(editStoreId, tiktokId, previousSku) && checkTikTokId(editStoreId, tiktokId, editSku)
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
    if (editStore && isTikTokStore(editStore)) {
      const { error: idError } = await saveTikTokId(editStore, tiktokId, editSku, previousSku)
      if (idError) {
        onChanged(`Store SKU updated, but saving the TikTok SKU ID failed: ${idError.message}`)
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
  const hasTikTok = stores.some(isTikTokStore)

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
                {hasTikTok && <th style={thStyle}>TikTok SKU ID</th>}
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
                    {hasTikTok && (
                      <td style={tdStyle}>
                        {isTikTokStore(stores.find((st) => st.id === editStoreId)) ? (
                          <input placeholder="Required" value={editTikTokId} onChange={(e) => setEditTikTokId(e.target.value)} style={{ ...inputStyle, width: '170px' }} />
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
                    {hasTikTok && (
                      <td style={tdStyle}>
                        {isTikTokStore(stores.find((st) => st.id === listing.store_id))
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
          {isTikTokStore(stores.find((st) => st.id === addStoreId)) && (
            idsFor(addStoreId, addSku.trim()).length > 0 ? (
              <span style={{ fontSize: '13px', color: muted }}>TikTok SKU ID {idsFor(addStoreId, addSku.trim()).join(', ')} already on file</span>
            ) : (
              <input placeholder="TikTok SKU ID (required)" value={addTikTokId} onChange={(e) => setAddTikTokId(e.target.value)} style={{ ...inputStyle, width: '210px' }} />
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
