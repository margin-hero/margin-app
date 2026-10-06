'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import StoreListings, { Listing, ChannelSkuId, loadChannelSkuIds } from '@/components/StoreListings'
import NextStep from '@/components/NextStep'
import { loadStores, Store, storeLabel } from '@/lib/stores'
import { loadCostTypes, CostType, hasDoubleCountRisk } from '@/lib/costTypes'
import { loadShippingProfiles, ShippingProfile } from '@/lib/shipping'
import Link from 'next/link'
import { vatSplitNote, ukDate } from '@/lib/format'
import { lime, red, amber, green, muted, text, bg, border, pageStyle, eyebrow, pageTitle, cardStyle, cardTitle, thStyle, tdStyle, inputStyle, primaryButton, linkButton, statusColor, radius } from '@/lib/theme'

type Product = {
  id: string
  standard_sku: string
  name: string
  vat_rate: number
}

type CogsRow = {
  id: string
  component_type: string
  description: string | null
  amount_pence: number
  vat_rate: number
  effective_from: string
  store_id: string | null // null = all stores; set = this store only (e.g. FBA prep)
}

type ShippingRow = {
  id: string
  qty: number
  courier_cost_pence: number
  vat_rate: number
  service_level: string
  effective_from: string
  store_id: string | null
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function ProductDetailPage() {
  const params = useParams()
  const router = useRouter()
  const productId = params.id as string

  const [product, setProduct] = useState<Product | null>(null)
  const [cogs, setCogs] = useState<CogsRow[]>([])
  const [shipping, setShipping] = useState<ShippingRow[]>([])
  const [profiles, setProfiles] = useState<ShippingProfile[]>([])
  const [profileAssignments, setProfileAssignments] = useState<{ id: string; store_id: string | null; shipping_profile_id: string | null }[]>([])
  const [overrideStoreId, setOverrideStoreId] = useState('')
  const [overrideProfileId, setOverrideProfileId] = useState('')
  const [stores, setStores] = useState<Store[]>([])
  const [costTypes, setCostTypes] = useState<CostType[]>([])
  const [status, setStatus] = useState('')
  const [listings, setListings] = useState<Listing[]>([])
  const [allProducts, setAllProducts] = useState<{ id: string; name: string; standard_sku: string }[]>([])
  const [skuIds, setSkuIds] = useState<ChannelSkuId[]>([])
  const [isNew, setIsNew] = useState(false) // just added on the Products page
  const [editingDetails, setEditingDetails] = useState(false)
  const [editSku, setEditSku] = useState('')
  const [editName, setEditName] = useState('')

  const [newComponentType, setNewComponentType] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newCostStoreId, setNewCostStoreId] = useState('') // '' = all stores
  const [newAmount, setNewAmount] = useState('')
  const [newVatRate, setNewVatRate] = useState('')
  const [newEffectiveFrom, setNewEffectiveFrom] = useState(today())
  const [newEffectiveTouched, setNewEffectiveTouched] = useState(false) // true once the date is picked by hand
  const [newQty, setNewQty] = useState('')
  const [newShippingCost, setNewShippingCost] = useState('')
  const [newShippingVat, setNewShippingVat] = useState('')
  const [newServiceLevel, setNewServiceLevel] = useState('standard')
  const [newShippingEffectiveFrom, setNewShippingEffectiveFrom] = useState(today())
  const [newShippingEffectiveTouched, setNewShippingEffectiveTouched] = useState(false)
  const [firstOrderDate, setFirstOrderDate] = useState<string | null>(null) // earliest order for this product, any store
  const [newShippingStoreId, setNewShippingStoreId] = useState('')

  const [editingCogsId, setEditingCogsId] = useState<string | null>(null)
  const [editComponentType, setEditComponentType] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editCostStoreId, setEditCostStoreId] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editVatRate, setEditVatRate] = useState('')
  const [editEffectiveFrom, setEditEffectiveFrom] = useState('')

  const [editingShippingId, setEditingShippingId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editShippingCost, setEditShippingCost] = useState('')
  const [editShippingVat, setEditShippingVat] = useState('')
  const [editServiceLevel, setEditServiceLevel] = useState('standard')
  const [editShippingStoreId, setEditShippingStoreId] = useState('')
  const [editShippingEffectiveFrom, setEditShippingEffectiveFrom] = useState('')

  async function loadAll() {
    const { data: productData } = await supabase
      .from('master_products')
      .select('id, standard_sku, name, vat_rate')
      .eq('id', productId)
      .single()
    setProduct(productData)

    const { data: cogsData } = await supabase
      .from('cogs_components')
      .select('id, component_type, description, amount_pence, vat_rate, effective_from, store_id')
      .eq('master_product_id', productId)
      .order('component_type')
      .order('effective_from')
    setCogs(cogsData || [])

    const { data: shippingData } = await supabase
      .from('shipping_rules')
      .select('id, qty, courier_cost_pence, vat_rate, service_level, effective_from, store_id')
      .eq('master_product_id', productId)
      .order('qty')
    setShipping(shippingData || [])

    setStores(await loadStores())

    const { data: listingData } = await supabase
      .from('platform_listings')
      .select('id, store_id, platform_sku, units_per_sale, stores(name, platforms(name))')
      .eq('master_product_id', productId)
      .order('platform_sku')
    setListings((listingData as any) || [])
    const { data: productList } = await fetchAll((from, to) =>
      supabase.from('master_products').select('id, name, standard_sku').order('standard_sku').order('id').range(from, to)
    )
    setAllProducts(productList || [])
    setSkuIds(await loadChannelSkuIds())

    setProfiles(await loadShippingProfiles())
    const { data: assignmentData } = await supabase
      .from('product_shipping_profiles')
      .select('id, store_id, shipping_profile_id')
      .eq('master_product_id', productId)
    setProfileAssignments(assignmentData || [])
    setCostTypes(await loadCostTypes())

    const { data: firstOrder } = await supabase
      .from('order_margins')
      .select('order_date')
      .eq('master_product_id', productId)
      .order('order_date')
      .limit(1)
    setFirstOrderDate(firstOrder?.[0]?.order_date ?? null)
  }

  useEffect(() => {
    loadAll()
  }, [productId])

  // "?new=1": arrived straight from adding the product, so show what to do next
  useEffect(() => {
    setIsNew(new URLSearchParams(window.location.search).get('new') === '1')
  }, [])

  // Default "effective from": the first cost of a type (or the first shipping rule) should cover
  // every past order, so it starts at the product's first order date. A further cost of a type
  // that already has one is usually a genuine price change, so it starts today.
  useEffect(() => {
    if (newEffectiveTouched) return
    const existing = cogs.some((c) => c.component_type === newComponentType && (c.description || '') === newDescription.trim() && (c.store_id || '') === newCostStoreId)
    setNewEffectiveFrom(firstOrderDate && !existing ? firstOrderDate : today())
  }, [firstOrderDate, cogs, newComponentType, newDescription, newEffectiveTouched])

  useEffect(() => {
    if (newShippingEffectiveTouched) return
    setNewShippingEffectiveFrom(firstOrderDate && shipping.length === 0 ? firstOrderDate : today())
  }, [firstOrderDate, shipping, newShippingEffectiveTouched])

  async function updateProductVatRate(rate: number) {
    await supabase.from('master_products').update({ vat_rate: rate }).eq('id', productId)
    setStatus('VAT rate updated. It applies to sales imported from now on.')
    loadAll()
  }

  async function saveDetails() {
    if (!editSku.trim() || !editName.trim()) {
      setStatus('Please enter both a SKU and a name.')
      return
    }
    const { error } = await supabase.from('master_products').update({ standard_sku: editSku.trim(), name: editName.trim() }).eq('id', productId)
    if (error) {
      setStatus(`Error updating product: ${error.message}`)
      return
    }
    setEditingDetails(false)
    setStatus('Product details updated.')
    loadAll()
  }

  // Only a product with no store SKUs can be deleted (so its sales are never orphaned)
  async function deleteProduct() {
    if (listings.length > 0) {
      setStatus('This product still has store SKUs: move or delete those first.')
      return
    }
    if (!window.confirm(`Delete ${product?.name}? Its costs and shipping settings are deleted too.`)) return
    await supabase.from('cogs_components').delete().eq('master_product_id', productId)
    await supabase.from('shipping_rules').delete().eq('master_product_id', productId)
    await supabase.from('product_shipping_profiles').delete().eq('master_product_id', productId)
    const { error } = await supabase.from('master_products').delete().eq('id', productId)
    if (error) {
      setStatus(`Error deleting product: ${error.message}`)
      loadAll()
      return
    }
    router.push('/products')
  }

  function listingsChanged(message: string) {
    setStatus(message)
    loadAll()
  }

  async function addCogsRow() {
    if (!newComponentType || !newAmount || newVatRate === '' || !newEffectiveFrom) {
      setStatus('Please choose a cost type and enter an amount, VAT rate, and effective date.')
      return
    }
    const { error } = await supabase.from('cogs_components').insert({
      master_product_id: productId,
      component_type: newComponentType,
      description: newDescription.trim() || null,
      store_id: newCostStoreId || null,
      amount_pence: Math.round(parseFloat(newAmount) * 100),
      vat_rate: parseFloat(newVatRate),
      effective_from: newEffectiveFrom,
    })
    if (error) {
      setStatus(`Error adding cost: ${error.message}`)
      return
    }
    setNewComponentType('')
    setNewDescription('')
    setNewCostStoreId('')
    setNewAmount('')
    setNewVatRate('')
    setNewEffectiveTouched(false)
    setStatus('Cost added.')
    loadAll()
  }

  function startEditCogs(row: CogsRow) {
    setEditingCogsId(row.id)
    setEditComponentType(row.component_type)
    setEditDescription(row.description || '')
    setEditCostStoreId(row.store_id || '')
    setEditAmount((row.amount_pence / 100).toString())
    setEditVatRate(row.vat_rate.toString())
    setEditEffectiveFrom(row.effective_from)
  }

  async function saveCogsEdit(id: string) {
    const { error } = await supabase
      .from('cogs_components')
      .update({
        component_type: editComponentType,
        description: editDescription.trim() || null,
        store_id: editCostStoreId || null,
        amount_pence: Math.round(parseFloat(editAmount) * 100),
        vat_rate: parseFloat(editVatRate),
        effective_from: editEffectiveFrom,
      })
      .eq('id', id)
    if (error) {
      setStatus(`Error saving correction: ${error.message}`)
      return
    }
    setEditingCogsId(null)
    setStatus('Correction saved — this updates margin for all orders using this cost, past and future.')
    loadAll()
  }

  async function deleteCogsRow(id: string) {
    await supabase.from('cogs_components').delete().eq('id', id)
    setStatus('Cost removed.')
    loadAll()
  }

  async function addShippingRow() {
    if (!newQty || !newShippingCost || newShippingVat === '' || !newShippingEffectiveFrom) {
      setStatus('Please enter a quantity, cost, VAT rate, and effective date.')
      return
    }
    const { error } = await supabase.from('shipping_rules').insert({
      master_product_id: productId,
      qty: parseInt(newQty),
      courier_cost_pence: Math.round(parseFloat(newShippingCost) * 100),
      vat_rate: parseFloat(newShippingVat),
      service_level: newServiceLevel,
      effective_from: newShippingEffectiveFrom,
      store_id: newShippingStoreId || null,
    })
    if (error) {
      setStatus(`Error adding shipping rule: ${error.message}`)
      return
    }
    setNewQty('')
    setNewShippingCost('')
    setNewShippingVat('')
    setNewShippingEffectiveTouched(false)
    setStatus('Shipping rule added.')
    loadAll()
  }

  function startEditShipping(row: ShippingRow) {
    setEditingShippingId(row.id)
    setEditQty(row.qty.toString())
    setEditShippingCost((row.courier_cost_pence / 100).toString())
    setEditShippingVat(row.vat_rate.toString())
    setEditServiceLevel(row.service_level)
    setEditShippingStoreId(row.store_id || '')
    setEditShippingEffectiveFrom(row.effective_from)
  }

  async function saveShippingEdit(id: string) {
    const { error } = await supabase
      .from('shipping_rules')
      .update({
        qty: parseInt(editQty),
        courier_cost_pence: Math.round(parseFloat(editShippingCost) * 100),
        vat_rate: parseFloat(editShippingVat),
        service_level: editServiceLevel,
        store_id: editShippingStoreId || null,
        effective_from: editShippingEffectiveFrom,
      })
      .eq('id', id)
    if (error) {
      setStatus(`Error saving correction: ${error.message}`)
      return
    }
    setEditingShippingId(null)
    setStatus('Correction saved.')
    loadAll()
  }

  async function deleteShippingRow(id: string) {
    await supabase.from('shipping_rules').delete().eq('id', id)
    setStatus('Shipping rule removed.')
    loadAll()
  }

  // The all-stores profile: replace whatever is there ('' = remove it)
  async function setDefaultProfile(profileId: string) {
    await supabase.from('product_shipping_profiles').delete().eq('master_product_id', productId).is('store_id', null)
    if (profileId) {
      const { error } = await supabase.from('product_shipping_profiles').insert({ master_product_id: productId, store_id: null, shipping_profile_id: profileId })
      if (error) {
        setStatus(`Error setting shipping profile: ${error.message}`)
        return
      }
    }
    setStatus(profileId ? 'Shipping profile set for all stores.' : 'Shipping profile removed.')
    loadAll()
  }

  // A different profile in one store, or 'none' = no shipping cost there (e.g. FBA)
  async function addOverride() {
    if (!overrideStoreId || !overrideProfileId) {
      setStatus('Choose a store and a profile (or "No shipping cost").')
      return
    }
    await supabase.from('product_shipping_profiles').delete().eq('master_product_id', productId).eq('store_id', overrideStoreId)
    const { error } = await supabase.from('product_shipping_profiles').insert({
      master_product_id: productId,
      store_id: overrideStoreId,
      shipping_profile_id: overrideProfileId === 'none' ? null : overrideProfileId,
    })
    if (error) {
      setStatus(`Error adding store exception: ${error.message}`)
      return
    }
    setOverrideStoreId('')
    setOverrideProfileId('')
    setStatus('Store exception saved.')
    loadAll()
  }

  async function removeOverride(id: string) {
    await supabase.from('product_shipping_profiles').delete().eq('id', id)
    setStatus('Store exception removed.')
    loadAll()
  }

  if (!product) return <div style={pageStyle}><p style={{ color: muted }}>Loading...</p></div>

  const defaultAssignment = profileAssignments.find((a) => a.store_id === null)
  const storeOverrides = profileAssignments.filter((a) => a.store_id !== null)
  const profileName = (id: string | null) => (id ? profiles.find((p) => p.id === id)?.name || '?' : 'No shipping cost')

  const smallInput: React.CSSProperties = { ...inputStyle, width: '100px' }
  const cancelButton: React.CSSProperties = { ...linkButton, color: muted }
  const deleteButton: React.CSSProperties = { ...linkButton, color: red }
  // Under a date box: when this product's first order was, in amber if the date misses some orders
  const dateHint = (date: string) => {
    if (!firstOrderDate || !date) return null
    const missesOrders = date > firstOrderDate
    return (
      <div style={{ fontSize: '11px', color: missesOrders ? amber : muted, marginTop: '4px', maxWidth: '240px' }}>
        First order for this product: {ukDate(firstOrderDate)}.{missesOrders ? ` Orders before ${ukDate(date)} won't get this cost.` : ''}
      </div>
    )
  }
  const help: React.CSSProperties = { color: muted, fontSize: '13px', lineHeight: 1.5, margin: '0 0 12px' }
  const landedCodes = new Set(costTypes.filter((t) => t.in_gross).map((t) => t.code))
  const steps = [
    { id: 'details', label: 'Details', done: true },
    { id: 'store-skus', label: 'Store SKUs', done: listings.length > 0 },
    { id: 'costs', label: 'Costs', done: cogs.some((c) => landedCodes.has(c.component_type)) },
    { id: 'shipping', label: 'Shipping', done: !!defaultAssignment?.shipping_profile_id || shipping.length > 0 },
  ]

  return (
    <div style={pageStyle}>
      <p style={eyebrow}><Link href="/products" style={{ color: lime, textDecoration: 'none' }}>← Products</Link></p>
      <h1 style={pageTitle}>{product.name}</h1>
      <p style={{ color: muted, fontSize: '15px', margin: 0 }}>{product.standard_sku}</p>

      {/* Set-up progress: each step jumps to its section */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '16px' }}>
        {steps.map((st, i) => (
          <a key={st.id} href={`#${st.id}`} style={{ fontSize: '13px', fontWeight: 700, padding: '6px 12px', borderRadius: radius, textDecoration: 'none', border: `1px solid ${st.done ? green : border}`, color: st.done ? green : muted }}>
            {st.done ? '✓' : i + 1}. {st.label}
          </a>
        ))}
      </div>

      {isNew && (
        <div style={{ ...cardStyle, borderColor: green }}>
          <p style={{ margin: 0, fontSize: '14px', color: text, lineHeight: 1.5 }}>
            <strong style={{ color: green }}>Product added.</strong> Now work down this page: add the SKU each store uses for it (2),
            its costs (3) and how it ships (4). Steps turn green as they&apos;re done.
          </p>
        </div>
      )}

      {/* Kept in view while scrolling, since most actions are further down the page */}
      {status && (
        <p style={{ position: 'sticky', top: 0, zIndex: 5, background: bg, color: statusColor(status), fontSize: '14px', fontWeight: 600, margin: '16px 0 0', padding: '10px 0', borderBottom: `1px solid ${border}` }}>
          {status}
        </p>
      )}

      <section id="details" style={cardStyle}>
        <p style={cardTitle}>1. Details</p>
        {editingDetails ? (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
            <input value={editSku} onChange={(e) => setEditSku(e.target.value)} placeholder="Your SKU" style={{ ...inputStyle, width: '160px' }} />
            <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Product name" style={{ ...inputStyle, width: '260px' }} />
            <button onClick={saveDetails} style={linkButton}>Save</button>
            <button onClick={() => setEditingDetails(false)} style={cancelButton}>Cancel</button>
          </div>
        ) : (
          <p style={{ fontSize: '14px', margin: '0 0 14px' }}>
            <span style={{ color: muted }}>SKU</span> <strong>{product.standard_sku}</strong>
            <span style={{ color: muted, marginLeft: '16px' }}>Name</span> <strong>{product.name}</strong>{' '}
            <button onClick={() => { setEditSku(product.standard_sku); setEditName(product.name); setEditingDetails(true) }} style={linkButton}>Edit</button>
          </p>
        )}
        <label style={{ fontSize: '14px', color: text }}>
          VAT rate on sales:{' '}
          <select value={product.vat_rate} onChange={(e) => updateProductVatRate(parseFloat(e.target.value))} style={{ ...inputStyle, marginLeft: '6px' }}>
            <option value="0">0% (VAT-free / zero-rated)</option>
            <option value="0.05">5% (Reduced rate)</option>
            <option value="0.2">20% (Standard rate)</option>
          </select>
        </label>
        <p style={{ ...help, marginTop: '10px', marginBottom: 0 }}>
          The VAT you charge customers on this product. When a channel&apos;s report doesn&apos;t show the VAT in a sale (e.g. OnBuy, Shopify, eBay),
          it&apos;s worked out from this rate when the sale is imported, so a change applies to sales imported from then on.
        </p>
        {listings.length === 0 && (
          <button onClick={deleteProduct} style={{ ...deleteButton, padding: 0, marginTop: '12px' }}>Delete this product</button>
        )}
      </section>

      <section id="store-skus" style={cardStyle}>
        <p style={cardTitle}>2. Store SKUs</p>
        <p style={help}>
          The SKU each store uses for this product, so imported sales find it. Units per sale is for bundles and multipacks
          (e.g. a 3-pack listing = 3), so cost and shipping are counted for the right number of units.
          See every product&apos;s at once on <Link href="/mappings" style={{ color: lime, fontWeight: 700 }}>Store SKUs</Link>.
        </p>
        {stores.length === 0 ? (
          <p style={{ color: amber, fontSize: '14px', margin: 0 }}>
            No stores yet. <Link href="/stores" style={{ color: amber, fontWeight: 700 }}>Add your stores</Link> first, then come back here.
          </p>
        ) : (
          <StoreListings productId={productId} listings={listings} stores={stores} allProducts={allProducts} skuIds={skuIds} onChanged={listingsChanged} />
        )}
      </section>

      <section id="costs" style={cardStyle}>
        <p style={cardTitle}>3. Costs</p>
        <p style={help}>
          <strong>Per unit</strong> costs are multiplied by the quantity sold (bundles included). <strong>Per order</strong> costs, like a box or pick &amp; pack,
          are charged once per order line. <strong>Landed cost</strong> types (all-in, or product cost + freight + duty) count in Gross Profit; everything counts in Net.
          Two costs of the same type both apply if they have different descriptions. A cost can apply to <strong>all stores</strong> or <strong>one store only</strong>
          (e.g. FBA prep or inbound freight to Amazon for your FBA store); for the same type and description, a store&apos;s own cost is used instead of the all-stores one.
        </p>
        {hasDoubleCountRisk(cogs.filter((c) => c.effective_from <= today()).map((c) => c.component_type)) && (
          <p style={{ color: red, fontSize: '14px', fontWeight: 600 }}>
            ⚠ This product has an all-in landed cost AND product cost / freight / duty in effect. If the all-in figure already includes those, they&apos;re being counted twice.
          </p>
        )}
        <p style={help}>
          <strong>Edit</strong> corrects a mistake — it changes margin for every order using this cost, past and future.
          To reflect a genuine price change from today onward while keeping historical accuracy, use <strong>Add Cost</strong> below instead of editing.
        </p>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Amount (inc. VAT)</th>
              <th style={thStyle}>VAT Rate</th>
              <th style={thStyle}>Effective From</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {cogs.map((row) =>
              editingCogsId === row.id ? (
                <tr key={row.id} style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <td style={tdStyle}>
                    <select value={editComponentType} onChange={(e) => setEditComponentType(e.target.value)} style={inputStyle}>
                      <option value="">Select cost type...</option>
                      <optgroup label="Per unit (× quantity sold)">
                        {costTypes.filter((t) => t.basis === 'per_unit').map((t) => (
                          <option key={t.code} value={t.code}>{t.label}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Per order (once per order line)">
                        {costTypes.filter((t) => t.basis === 'per_order').map((t) => (
                          <option key={t.code} value={t.code}>{t.label}</option>
                        ))}
                      </optgroup>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Optional" style={smallInput} />
                    <select value={editCostStoreId} onChange={(e) => setEditCostStoreId(e.target.value)} style={{ ...inputStyle, display: 'block', marginTop: '6px' }}>
                      <option value="">All stores</option>
                      {stores.map((st) => <option key={st.id} value={st.id}>Only {storeLabel(st)}</option>)}
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <input placeholder="£ inc. VAT" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} style={smallInput} />
                    {vatSplitNote(editAmount, editVatRate) && <div style={{ fontSize: '11px', color: muted, marginTop: '4px', maxWidth: '220px' }}>{vatSplitNote(editAmount, editVatRate)}</div>}
                  </td>
                  <td style={tdStyle}>
                    <select value={editVatRate} onChange={(e) => setEditVatRate(e.target.value)} style={inputStyle}>
                      <option value="0">0%</option>
                      <option value="0.05">5%</option>
                      <option value="0.2">20%</option>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <input type="date" value={editEffectiveFrom} onChange={(e) => setEditEffectiveFrom(e.target.value)} style={inputStyle} />
                    {dateHint(editEffectiveFrom)}
                  </td>
                  <td style={tdStyle}>
                    <button onClick={() => saveCogsEdit(row.id)} style={linkButton}>Save</button>
                    <button onClick={() => setEditingCogsId(null)} style={cancelButton}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id}>
                  <td style={tdStyle}>
                    {costTypes.find((t) => t.code === row.component_type)?.label || row.component_type}
                    <span style={{ color: muted, fontSize: '12px', marginLeft: '6px' }}>
                      {costTypes.find((t) => t.code === row.component_type)?.basis === 'per_order' ? 'per order' : 'per unit'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {row.description || ''}
                    {row.store_id && <div style={{ fontSize: '12px', color: muted }}>Only {storeLabel(stores.find((st) => st.id === row.store_id))}</div>}
                  </td>
                  <td style={tdStyle}>£{(row.amount_pence / 100).toFixed(2)}</td>
                  <td style={tdStyle}>{(row.vat_rate * 100).toFixed(0)}%</td>
                  <td style={tdStyle}>
                    {ukDate(row.effective_from)}
                    {/* The first entry of a cost starting after this product's first order: earlier orders miss it */}
                    {firstOrderDate && row.effective_from > firstOrderDate &&
                      !cogs.some((c) => c.component_type === row.component_type && (c.description || '') === (row.description || '') && (c.store_id || '') === (row.store_id || '') && c.effective_from < row.effective_from) && (
                      <div style={{ fontSize: '11px', color: amber, marginTop: '4px', maxWidth: '220px' }}>
                        Starts after this product&apos;s first order ({ukDate(firstOrderDate)}), so earlier orders don&apos;t include it. If it applied then too, Edit the date.
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <button onClick={() => startEditCogs(row)} style={linkButton}>
                      Edit
                    </button>
                    <button onClick={() => deleteCogsRow(row.id)} style={deleteButton}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>

        <div style={{ marginTop: '1rem', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={newComponentType} onChange={(e) => setNewComponentType(e.target.value)} style={inputStyle}>
            <option value="">Select cost type...</option>
            <optgroup label="Per unit (× quantity sold)">
              {costTypes.filter((t) => t.basis === 'per_unit').map((t) => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </optgroup>
            <optgroup label="Per order (once per order line)">
              {costTypes.filter((t) => t.basis === 'per_order').map((t) => (
                <option key={t.code} value={t.code}>{t.label}</option>
              ))}
            </optgroup>
          </select>
          <input
            placeholder="Description (optional)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            style={{ ...inputStyle, width: '170px' }}
          />
          <select value={newCostStoreId} onChange={(e) => setNewCostStoreId(e.target.value)} style={inputStyle} aria-label="Which stores this cost applies to">
            <option value="">All stores</option>
            {stores.map((st) => <option key={st.id} value={st.id}>Only {storeLabel(st)}</option>)}
          </select>
          <input
            placeholder="£ inc. VAT"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            style={{ ...inputStyle, width: '100px' }}
          />
          <select value={newVatRate} onChange={(e) => setNewVatRate(e.target.value)} style={inputStyle}>
            <option value="">Select VAT rate...</option>
            <option value="0">0% (VAT-free / labour / zero-rated)</option>
            <option value="0.05">5% (Reduced rate)</option>
            <option value="0.2">20% (Standard rate)</option>
          </select>
          <div>
            <input
              type="date"
              value={newEffectiveFrom}
              onChange={(e) => { setNewEffectiveFrom(e.target.value); setNewEffectiveTouched(true) }}
              style={inputStyle}
            />
            <div style={{ fontSize: '11px', color: muted, marginTop: '4px' }}>Effective from — today for a new price, or an earlier date if backfilling history</div>
            {dateHint(newEffectiveFrom)}
          </div>
          <button onClick={addCogsRow} style={primaryButton}>Add Cost</button>
        </div>
        <p style={{ ...help, marginTop: '10px' }}>
          Enter the amount <strong>including VAT</strong>, i.e. what you actually pay. If a store is VAT registered, the VAT is taken off for you.
          {vatSplitNote(newAmount, newVatRate) && <><br /><span style={{ color: text }}>{vatSplitNote(newAmount, newVatRate)}</span></>}
        </p>
        {newComponentType && (
          <p style={{ ...help, marginTop: '10px' }}>
            {costTypes.find((t) => t.code === newComponentType)?.description}
          </p>
        )}
      </section>

      <section id="shipping" style={cardStyle}>
        <p style={cardTitle}>4. Shipping</p>
        {profiles.length === 0 && (
          <p style={{ color: amber, fontSize: '14px', lineHeight: 1.5, margin: '0 0 12px' }}>
            No shipping profiles yet. Add your couriers and their prices on <Link href="/couriers" style={{ color: amber, fontWeight: 700 }}>Couriers</Link>,
            then build a profile on <Link href="/shipping-profiles" style={{ color: amber, fontWeight: 700 }}>Shipping Profiles</Link> (e.g. 1–2 units = 1 × Evri Medium), and choose it here.
            If a channel buys your labels (e.g. Amazon), its real label cost is used instead.
          </p>
        )}
        <p style={help}>
          How this product ships. Profiles and courier prices are managed on the <Link href="/shipping-profiles" style={{ color: lime, fontWeight: 700 }}>Shipping Profiles</Link> and <Link href="/couriers" style={{ color: lime, fontWeight: 700 }}>Couriers</Link> pages.
          The real label cost from a channel (e.g. Amazon) and any exact-price shipping rules below take priority over the profile.
        </p>
        <label style={{ fontSize: '14px', color: text }}>
          All stores:{' '}
          <select value={defaultAssignment?.shipping_profile_id || ''} onChange={(e) => setDefaultProfile(e.target.value)} style={{ ...inputStyle, marginLeft: '6px' }}>
            <option value="">No profile</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <p style={{ ...cardTitle, margin: '22px 0 10px' }}>Store exceptions</p>
        {storeOverrides.length === 0 && <p style={help}>None: every store uses the profile above.</p>}
        {storeOverrides.map((o) => (
          <p key={o.id} style={{ fontSize: '14px', margin: '4px 0' }}>
            <strong>{storeLabel(stores.find((st) => st.id === o.store_id))}</strong>: {profileName(o.shipping_profile_id)}{' '}
            <button onClick={() => removeOverride(o.id)} style={deleteButton}>Remove</button>
          </p>
        ))}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
          <select value={overrideStoreId} onChange={(e) => setOverrideStoreId(e.target.value)} style={inputStyle}>
            <option value="">Store...</option>
            {stores.map((st) => <option key={st.id} value={st.id}>{storeLabel(st)}</option>)}
          </select>
          <select value={overrideProfileId} onChange={(e) => setOverrideProfileId(e.target.value)} style={inputStyle}>
            <option value="">Uses...</option>
            <option value="none">No shipping cost (e.g. Amazon FBA)</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={addOverride} style={primaryButton}>Add exception</button>
        </div>
      </section>

      <section style={cardStyle}>
        <p style={cardTitle}>Exact-price shipping rules (optional)</p>
        <p style={help}>Optional. A rule here beats the shipping profile for that exact quantity. Most products won&apos;t need any.</p>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>Store</th>
              <th style={thStyle}>Qty</th>
              <th style={thStyle}>Cost (inc. VAT)</th>
              <th style={thStyle}>VAT Rate</th>
              <th style={thStyle}>Service Level</th>
              <th style={thStyle}>Effective From</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {shipping.map((row) =>
              editingShippingId === row.id ? (
                <tr key={row.id} style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <td style={tdStyle}>
                    <select value={editShippingStoreId} onChange={(e) => setEditShippingStoreId(e.target.value)} style={inputStyle}>
                      <option value="">All stores</option>
                      {stores.map((st) => (
                        <option key={st.id} value={st.id}>{storeLabel(st)}</option>
                      ))}
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <input value={editQty} onChange={(e) => setEditQty(e.target.value)} style={{ ...smallInput, width: '70px' }} />
                  </td>
                  <td style={tdStyle}>
                    <input placeholder="£ inc. VAT" value={editShippingCost} onChange={(e) => setEditShippingCost(e.target.value)} style={smallInput} />
                    {vatSplitNote(editShippingCost, editShippingVat) && <div style={{ fontSize: '11px', color: muted, marginTop: '4px', maxWidth: '220px' }}>{vatSplitNote(editShippingCost, editShippingVat)}</div>}
                  </td>
                  <td style={tdStyle}>
                    <select value={editShippingVat} onChange={(e) => setEditShippingVat(e.target.value)} style={inputStyle}>
                      <option value="0">0%</option>
                      <option value="0.2">20%</option>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <select value={editServiceLevel} onChange={(e) => setEditServiceLevel(e.target.value)} style={inputStyle}>
                      <option value="standard">Standard</option>
                      <option value="express">Express</option>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <input type="date" value={editShippingEffectiveFrom} onChange={(e) => setEditShippingEffectiveFrom(e.target.value)} style={inputStyle} />
                    {dateHint(editShippingEffectiveFrom)}
                  </td>
                  <td style={tdStyle}>
                    <button onClick={() => saveShippingEdit(row.id)} style={linkButton}>Save</button>
                    <button onClick={() => setEditingShippingId(null)} style={cancelButton}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id}>
                  <td style={tdStyle}>{row.store_id ? storeLabel(stores.find((st) => st.id === row.store_id)) : 'All stores'}</td>
                  <td style={tdStyle}>{row.qty}</td>
                  <td style={tdStyle}>£{(row.courier_cost_pence / 100).toFixed(2)}</td>
                  <td style={tdStyle}>{(row.vat_rate * 100).toFixed(0)}%</td>
                  <td style={tdStyle}>{row.service_level}</td>
                  <td style={tdStyle}>{ukDate(row.effective_from)}</td>
                  <td style={tdStyle}>
                    <button onClick={() => startEditShipping(row)} style={linkButton}>
                      Edit
                    </button>
                    <button onClick={() => deleteShippingRow(row.id)} style={deleteButton}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>

        <p style={help}>
          If the courier price genuinely changes, use <strong>Add Rule</strong> with today's date — past orders keep the old rate, future orders use the new one.
          Use <strong>Edit</strong> on an existing row only to fix a mistake (it changes every order using that rule, past and future).
          A rule for a specific store (e.g. Amazon FR) overrides the <strong>All stores</strong> rule for that store's orders.
        </p>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={newShippingStoreId} onChange={(e) => setNewShippingStoreId(e.target.value)} style={inputStyle}>
                      <option value="">All stores</option>
                      {stores.map((st) => (
                        <option key={st.id} value={st.id}>{storeLabel(st)}</option>
                      ))}
                    </select>
          <input
            placeholder="Qty"
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
            style={{ ...inputStyle, width: '60px' }}
          />
          <input
            placeholder="£ inc. VAT"
            value={newShippingCost}
            onChange={(e) => setNewShippingCost(e.target.value)}
            style={{ ...inputStyle, width: '100px' }}
          />
          <select value={newShippingVat} onChange={(e) => setNewShippingVat(e.target.value)} style={inputStyle}>
            <option value="">Select VAT rate...</option>
            <option value="0">0%</option>
            <option value="0.2">20%</option>
          </select>
          <select value={newServiceLevel} onChange={(e) => setNewServiceLevel(e.target.value)} style={inputStyle}>
            <option value="standard">Standard</option>
            <option value="express">Express</option>
          </select>
          <div>
            <input
              type="date"
              value={newShippingEffectiveFrom}
              onChange={(e) => { setNewShippingEffectiveFrom(e.target.value); setNewShippingEffectiveTouched(true) }}
              style={inputStyle}
            />
            <div style={{ fontSize: '11px', color: muted, marginTop: '4px' }}>Effective from</div>
            {dateHint(newShippingEffectiveFrom)}
          </div>
          <button onClick={addShippingRow} style={primaryButton}>Add Rule</button>
        </div>
        <p style={{ ...help, marginTop: '10px' }}>
          Enter the cost <strong>including VAT</strong>, i.e. what you actually pay. If a store is VAT registered, the VAT is taken off for you.
          {vatSplitNote(newShippingCost, newShippingVat) && <><br /><span style={{ color: text }}>{vatSplitNote(newShippingCost, newShippingVat)}</span></>}
        </p>
      </section>

      {steps.every((st) => st.done) ? (
        <NextStep href="/products" label="Add another product" text="This product is set up. Add the next one, or import your sales from the Import menu." />
      ) : (
        <NextStep href="/getting-started" label="Getting started checklist" text="Not everything's done yet: the steps at the top of this page show what's left." />
      )}
    </div>
  )
}
