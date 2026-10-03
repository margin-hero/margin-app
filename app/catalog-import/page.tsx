'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { readSpreadsheet } from '@/lib/readSpreadsheet'
import { loadStores, Store, storeLabel, isTikTokStore } from '@/lib/stores'
import { lime, red, muted, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, linkButton } from '@/lib/theme'

// One row per listing: a product in 3 stores = 3 rows. A row with only
// standard_sku + name (no store) just creates the product.
const REQUIRED_COLUMNS = ['standard_sku', 'name', 'store', 'store_sku']
const TEMPLATE = [
  'standard_sku,name,store,store_sku,units_per_sale,tiktok_sku_id',
  'MUG-01,Blue Mug,Amazon UK,AMZ-MUG-01,1,',
  'MUG-01,Blue Mug,Argos,88812345,1,',
  'MUG-01,Blue Mug,TikTok,MUG-01,1,1729384756102937',
  'MUG-01-2PK,Blue Mug x2,Amazon UK,AMZ-MUG-2PK,2,',
  'RAKE-3,Garden Rake,,,,',
].join('\n')

type NewProduct = { standardSku: string; name: string }
type NewListing = { standardSku: string; store: Store; storeSku: string; units: number }
type Problem = { row: number; message: string }
type NewTikTokId = { store: Store; skuId: string; sellerSku: string }
type Plan = { tenantId: string; newProducts: NewProduct[]; newListings: NewListing[]; newTikTokIds: NewTikTokId[]; unchanged: number; problems: Problem[] }

export default function CatalogImportPage() {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'margin-hero-catalog-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPlan(null)
    setStatus('Reading file and checking against your existing products...')

    let rows: Record<string, string>[]
    try {
      rows = await readSpreadsheet(file)
    } catch (err: any) {
      setStatus(`Could not read that file: ${err?.message || err}`)
      return
    }
    const missing = REQUIRED_COLUMNS.filter((c) => rows.length === 0 || !(c in rows[0]))
    if (missing.length) {
      setStatus(`The file is missing these column headings: ${missing.join(', ')}. Download the template to see the layout.`)
      return
    }

    const { data: tenant } = await supabase.from('tenants').select('id').eq('name', 'Test Store').single()
    if (!tenant) {
      setStatus('Could not find the tenant.')
      return
    }
    const stores = (await loadStores()).filter((s) => s.tenant_id === tenant.id)
    // The `store` column can be the store name, or "Name (Platform)" as shown in the store
    // dropdowns. The second form is needed when two platforms have a store with the same name.
    const storesByName = new Map<string, Store[]>()
    stores.forEach((s) => {
      const key = s.name.trim().toLowerCase()
      storesByName.set(key, [...(storesByName.get(key) || []), s])
    })
    const storeByLabel = new Map(stores.map((s) => [`${s.name.trim()} (${s.platforms?.name ?? ''})`.toLowerCase(), s]))
    stores.forEach((s) => storeByLabel.set(storeLabel(s).toLowerCase(), s))

    const { data: products, error: productsError } = await fetchAll((from, to) =>
      supabase.from('master_products').select('id, standard_sku').eq('tenant_id', tenant.id).order('id').range(from, to)
    )
    const { data: listings, error: listingsError } = stores.length
      ? await fetchAll((from, to) =>
          supabase
            .from('platform_listings')
            .select('id, store_id, platform_sku, master_product_id, units_per_sale')
            .in('store_id', stores.map((s) => s.id))
            .order('id')
            .range(from, to)
        )
      : { data: [], error: null }
    const tiktokStoreIds = stores.filter(isTikTokStore).map((s) => s.id)
    const { data: catalog, error: catalogError } = tiktokStoreIds.length
      ? await fetchAll((from, to) =>
          supabase.from('tiktok_sku_catalog').select('store_id, sku_id, seller_sku').in('store_id', tiktokStoreIds).order('store_id').order('sku_id').range(from, to)
        )
      : { data: [], error: null }
    if (productsError || listingsError || catalogError) {
      setStatus(`Error loading existing data: ${(productsError || listingsError || catalogError)!.message}`)
      return
    }
    // TikTok SKU IDs already on file: which store SKU owns each ID, and each store SKU's IDs
    const tiktokOwner = new Map(catalog.map((c) => [`${c.store_id}|${c.sku_id}`, c.seller_sku]))
    const tiktokIdsOf = new Map<string, string[]>()
    catalog.forEach((c) => tiktokIdsOf.set(`${c.store_id}|${c.seller_sku}`, [...(tiktokIdsOf.get(`${c.store_id}|${c.seller_sku}`) || []), c.sku_id]))
    const plannedTikTok = new Map<string, NewTikTokId>() // key store|sku_id

    const productIdBySku = new Map<string, string>()
    products.forEach((p) => { if (!productIdBySku.has(p.standard_sku)) productIdBySku.set(p.standard_sku, p.id) })
    const skuByProductId = new Map(products.map((p) => [p.id, p.standard_sku]))
    const listingByKey = new Map(listings.map((l) => [`${l.store_id}|${l.platform_sku}`, l]))

    const newProducts = new Map<string, NewProduct>()
    const plannedListings = new Map<string, NewListing>()
    const problems: Problem[] = []
    let unchanged = 0

    rows.forEach((r, i) => {
      const row = i + 2 // spreadsheet row number (headings are row 1)
      const standardSku = (r.standard_sku || '').trim()
      const name = (r.name || '').trim()
      const storeName = (r.store || '').trim()
      const storeSku = (r.store_sku || '').trim()
      const unitsText = (r.units_per_sale || '').trim()
      const units = unitsText === '' ? 1 : Number(unitsText)

      if (!standardSku && !name && !storeName && !storeSku) return // blank row
      if (!standardSku) return problems.push({ row, message: 'standard_sku is empty.' })
      if (!Number.isInteger(units) || units < 1) return problems.push({ row, message: `units_per_sale "${unitsText}" must be a whole number, 1 or more.` })
      if (!!storeName !== !!storeSku) return problems.push({ row, message: 'Fill in both store and store_sku, or leave both empty to just create the product.' })

      let store: Store | undefined
      if (storeName) {
        const sameName = storesByName.get(storeName.toLowerCase()) || []
        if (sameName.length > 1) {
          return problems.push({ row, message: `More than one store is called "${storeName}". Write it with its channel, e.g. ${sameName.map((s) => `"${s.name} (${s.platforms?.name})"`).join(' or ')}.` })
        }
        store = sameName[0] ?? storeByLabel.get(storeName.toLowerCase())
        if (!store) return problems.push({ row, message: `Store "${storeName}" doesn't exist. Add it on the Stores page first (the name must match, or use "Name (Channel)").` })
      }

      const existingProductId = productIdBySku.get(standardSku)
      const addProductIfNew = () => {
        if (!existingProductId && !newProducts.has(standardSku)) {
          newProducts.set(standardSku, { standardSku, name: name || standardSku })
        }
      }

      if (!store) {
        if (existingProductId) unchanged++
        else addProductIfNew()
        return
      }

      // TikTok stores: the row needs a TikTok SKU ID (unless one is already on file),
      // and an ID can only ever belong to one store SKU
      let tiktokToAdd: NewTikTokId | null = null
      if (isTikTokStore(store)) {
        const skuId = (r.tiktok_sku_id || '').trim()
        const known = tiktokIdsOf.get(`${store.id}|${storeSku}`) || []
        if (!skuId && known.length === 0) {
          return problems.push({ row, message: `${store.name} is a TikTok shop: add the tiktok_sku_id (the number from TikTok Seller Centre), or orders for this product won't match.` })
        }
        if (skuId) {
          if (!/^\d+$/.test(skuId)) return problems.push({ row, message: `tiktok_sku_id "${skuId}" should be digits only.` })
          const owner = tiktokOwner.get(`${store.id}|${skuId}`) || plannedTikTok.get(`${store.id}|${skuId}`)?.sellerSku
          if (owner && owner !== storeSku) return problems.push({ row, message: `TikTok SKU ID ${skuId} already belongs to store SKU "${owner}" in ${store.name}.` })
          if (known.length > 0 && !known.includes(skuId)) {
            return problems.push({ row, message: `${store.name} SKU "${storeSku}" already has TikTok SKU ID ${known.join(', ')}. Not changed — edit it in Mappings if that's wrong.` })
          }
          if (!owner) tiktokToAdd = { store, skuId, sellerSku: storeSku }
        }
      }
      const addTikTokId = () => {
        if (tiktokToAdd) plannedTikTok.set(`${tiktokToAdd.store.id}|${tiktokToAdd.skuId}`, tiktokToAdd)
      }

      // Check the store SKU isn't already mapped to a different product BEFORE
      // creating anything, so a clash never leaves an orphan product behind
      const key = `${store.id}|${storeSku}`
      const existingListing = listingByKey.get(key)
      if (existingListing) {
        if (existingListing.master_product_id !== existingProductId) {
          return problems.push({ row, message: `${store.name} SKU "${storeSku}" is already mapped to product "${skuByProductId.get(existingListing.master_product_id) || '?'}". Not changed — fix it in Mappings if that's wrong.` })
        }
        if (existingListing.units_per_sale !== units) {
          return problems.push({ row, message: `${store.name} SKU "${storeSku}" is already mapped with units per sale ${existingListing.units_per_sale}, file says ${units}. Not changed — edit it in Mappings if needed.` })
        }
        addTikTokId()
        if (!tiktokToAdd) unchanged++
        return
      }
      const planned = plannedListings.get(key)
      if (planned) {
        if (planned.standardSku !== standardSku) {
          problems.push({ row, message: `${store.name} SKU "${storeSku}" appears earlier in the file for product "${planned.standardSku}". A store SKU can only map to one product.` })
        }
        return
      }
      addProductIfNew()
      addTikTokId()
      plannedListings.set(key, { standardSku, store, storeSku, units })
    })

    const result: Plan = {
      tenantId: tenant.id,
      newProducts: Array.from(newProducts.values()),
      newListings: Array.from(plannedListings.values()),
      newTikTokIds: Array.from(plannedTikTok.values()),
      unchanged,
      problems,
    }
    setPlan(result)
    setStatus(
      `Ready: ${result.newProducts.length} new product(s), ${result.newListings.length} new store mapping(s)` +
      (result.newTikTokIds.length ? ` and ${result.newTikTokIds.length} TikTok SKU ID(s). ` : '. ') +
      `${result.unchanged} row(s) already set up. ` +
      (result.problems.length ? `${result.problems.length} row(s) have problems and will be skipped (listed below).` : 'No problems found.')
    )
  }

  async function handleImport() {
    if (!plan) return
    setBusy(true)
    const productIds = new Map<string, string>()

    // 1. New products
    for (let i = 0; i < plan.newProducts.length; i += 500) {
      setStatus(`Creating products (${i + 1}–${Math.min(i + 500, plan.newProducts.length)} of ${plan.newProducts.length})...`)
      const { data, error } = await supabase
        .from('master_products')
        .insert(plan.newProducts.slice(i, i + 500).map((p) => ({ tenant_id: plan.tenantId, standard_sku: p.standardSku, name: p.name })))
        .select('id, standard_sku')
      if (error) {
        setStatus(`Error creating products: ${error.message}. Nothing after this point was saved; fix the problem and choose the file again (already-created items will be recognised).`)
        setBusy(false)
        return
      }
      data.forEach((p) => productIds.set(p.standard_sku, p.id))
    }

    // 2. New store mappings (products that already existed are looked up again by SKU)
    const neededSkus = plan.newListings.map((l) => l.standardSku).filter((sku) => !productIds.has(sku))
    for (let i = 0; i < neededSkus.length; i += 200) {
      const { data } = await supabase
        .from('master_products')
        .select('id, standard_sku')
        .eq('tenant_id', plan.tenantId)
        .in('standard_sku', neededSkus.slice(i, i + 200))
      data?.forEach((p) => { if (!productIds.has(p.standard_sku)) productIds.set(p.standard_sku, p.id) })
    }
    for (let i = 0; i < plan.newListings.length; i += 500) {
      setStatus(`Creating store mappings (${i + 1}–${Math.min(i + 500, plan.newListings.length)} of ${plan.newListings.length})...`)
      const { error } = await supabase.from('platform_listings').insert(
        plan.newListings.slice(i, i + 500).map((l) => ({
          master_product_id: productIds.get(l.standardSku),
          store_id: l.store.id,
          platform_id: l.store.platform_id,
          platform_sku: l.storeSku,
          units_per_sale: l.units,
        }))
      )
      if (error) {
        setStatus(`Error creating store mappings: ${error.message}. Products were saved; choose the file again to retry the mappings.`)
        setBusy(false)
        return
      }
    }

    // 3. TikTok SKU IDs
    if (plan.newTikTokIds.length) {
      const { error } = await supabase.from('tiktok_sku_catalog').upsert(
        plan.newTikTokIds.map((t) => ({ tenant_id: t.store.tenant_id, store_id: t.store.id, sku_id: t.skuId, seller_sku: t.sellerSku })),
        { onConflict: 'store_id,sku_id' }
      )
      if (error) {
        setStatus(`Error saving TikTok SKU IDs: ${error.message}. Products and mappings were saved; choose the file again to retry.`)
        setBusy(false)
        return
      }
    }

    setStatus(
      `Done. Created ${plan.newProducts.length} product(s), ${plan.newListings.length} store mapping(s)` +
      (plan.newTikTokIds.length ? ` and ${plan.newTikTokIds.length} TikTok SKU ID(s).` : '.') +
      (plan.problems.length ? ` ${plan.problems.length} row(s) with problems were skipped.` : '') +
      ' Next: add costs for new products under Products.'
    )
    setPlan(null)
    setBusy(false)
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Catalog Import</h1>
      <p style={pageIntro}>
        Set up products and their SKU in each store in one go, before importing sales, so every order matches cleanly.
        This only ever <strong>adds</strong>. It never changes or deletes existing products or mappings.
      </p>

      <div style={cardStyle}>
        <p style={cardTitle}>File layout</p>
        <p style={{ fontSize: '14px', color: muted, margin: '0 0 12px', lineHeight: 1.6 }}>
          CSV or Excel, <strong style={{ color: text }}>one row per product per store</strong>. Columns:{' '}
          <code>standard_sku</code>, <code>name</code>, <code>store</code> (must match a name on the Stores page), <code>store_sku</code>,{' '}
          and optionally <code>units_per_sale</code> (for bundles, defaults to 1). Leave <code>store</code> and <code>store_sku</code> empty to just add a product.
          For TikTok shops, also fill in <code>tiktok_sku_id</code> (the number TikTok&apos;s reports use) and use your Seller SKU as the <code>store_sku</code>.
        </p>
        <button onClick={downloadTemplate} style={{ ...linkButton, padding: 0 }}>Download template ↓</button>
        <div style={{ marginTop: '18px' }}>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} disabled={busy} style={{ color: muted, fontSize: '14px' }} />
        </div>
        {status && <p style={{ color: lime, fontSize: '14px', fontWeight: 600, margin: '16px 0 0' }}>{status}</p>}
        {plan && (plan.newProducts.length > 0 || plan.newListings.length > 0 || plan.newTikTokIds.length > 0) && (
          <button onClick={handleImport} disabled={busy} style={{ ...primaryButton, marginTop: '18px', opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Importing...' : 'Confirm import'}
          </button>
        )}
      </div>

      {plan && plan.problems.length > 0 && (
        <div style={cardStyle}>
          <p style={{ ...cardTitle, color: red }}>Problems — these rows will be skipped ({plan.problems.length})</p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={{ ...thStyle, width: '70px' }}>Row</th><th style={thStyle}>Problem</th></tr></thead>
            <tbody>
              {plan.problems.slice(0, 200).map((p) => (
                <tr key={p.row}><td style={tdStyle}>{p.row}</td><td style={tdStyle}>{p.message}</td></tr>
              ))}
            </tbody>
          </table>
          {plan.problems.length > 200 && <p style={{ color: muted, fontSize: '13px' }}>...and {plan.problems.length - 200} more.</p>}
        </div>
      )}

      {plan && plan.newProducts.length > 0 && (
        <div style={cardStyle}>
          <p style={cardTitle}>New products ({plan.newProducts.length})</p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={thStyle}>Standard SKU</th><th style={thStyle}>Name</th></tr></thead>
            <tbody>
              {plan.newProducts.slice(0, 50).map((p) => (
                <tr key={p.standardSku}><td style={tdStyle}>{p.standardSku}</td><td style={tdStyle}>{p.name}</td></tr>
              ))}
            </tbody>
          </table>
          {plan.newProducts.length > 50 && <p style={{ color: muted, fontSize: '13px' }}>...and {plan.newProducts.length - 50} more.</p>}
        </div>
      )}

      {plan && plan.newListings.length > 0 && (
        <div style={cardStyle}>
          <p style={cardTitle}>New store mappings ({plan.newListings.length})</p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={thStyle}>Store</th><th style={thStyle}>Store SKU</th><th style={thStyle}>→ Product</th><th style={thStyle}>Units per sale</th></tr></thead>
            <tbody>
              {plan.newListings.slice(0, 50).map((l) => (
                <tr key={`${l.store.id}|${l.storeSku}`}>
                  <td style={tdStyle}>{l.store.name}</td><td style={tdStyle}>{l.storeSku}</td><td style={tdStyle}>{l.standardSku}</td><td style={tdStyle}>{l.units}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.newListings.length > 50 && <p style={{ color: muted, fontSize: '13px' }}>...and {plan.newListings.length - 50} more.</p>}
        </div>
      )}
    </div>
  )
}
