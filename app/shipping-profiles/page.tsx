'use client'

import { useEffect, useState } from 'react'
import NextStep from '@/components/NextStep'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import {
  loadCourierServices, loadShippingProfiles, CourierService, ShippingProfile,
  priceOn, today, testTenantId, bandLabel, bandWarnings, overlapsExisting,
} from '@/lib/shipping'
import { lime, red, amber, muted, text, border, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, inputStyle, primaryButton, linkButton } from '@/lib/theme'

type Product = { id: string; standard_sku: string; name: string }
type Assignment = { master_product_id: string; store_id: string | null; shipping_profile_id: string | null }

const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`

export default function ShippingProfilesPage() {
  const [profiles, setProfiles] = useState<ShippingProfile[]>([])
  const [services, setServices] = useState<CourierService[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')

  const [newProfileName, setNewProfileName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Add-band form (one profile at a time)
  const [bandProfileId, setBandProfileId] = useState<string | null>(null)
  const [bandMin, setBandMin] = useState('')
  const [bandMax, setBandMax] = useState('')
  const [bandParcels, setBandParcels] = useState('1')
  const [bandService, setBandService] = useState('')

  // Assign-to-products panel
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  async function load() {
    const [p, s, prods, assigns] = await Promise.all([
      loadShippingProfiles(),
      loadCourierServices(),
      fetchAll((from, to) => supabase.from('master_products').select('id, standard_sku, name').order('standard_sku').order('id').range(from, to)),
      fetchAll((from, to) => supabase.from('product_shipping_profiles').select('id, master_product_id, store_id, shipping_profile_id').order('id').range(from, to)),
    ])
    setProfiles(p)
    setServices(s)
    setProducts(prods.data)
    setAssignments(assigns.data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const serviceById = new Map(services.map((s) => [s.id, s]))
  const profileById = new Map(profiles.map((p) => [p.id, p]))
  const defaultProfileOf = new Map(assignments.filter((a) => a.store_id === null).map((a) => [a.master_product_id, a.shipping_profile_id]))
  const usedBy = (profileId: string) => assignments.filter((a) => a.shipping_profile_id === profileId).length

  async function addProfile() {
    if (!newProfileName.trim()) {
      setStatus('Please enter a profile name.')
      return
    }
    const tenantId = await testTenantId()
    const { error } = await supabase.from('shipping_profiles').insert({ tenant_id: tenantId, name: newProfileName.trim() })
    if (error) {
      setStatus(error.message.includes('duplicate') ? 'A profile with that name already exists.' : `Error: ${error.message}`)
      return
    }
    setStatus(`Created ${newProfileName.trim()}. Now add its quantity bands.`)
    setNewProfileName('')
    load()
  }

  async function renameProfile(id: string) {
    if (!renameValue.trim()) return
    const { error } = await supabase.from('shipping_profiles').update({ name: renameValue.trim() }).eq('id', id)
    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }
    setRenamingId(null)
    load()
  }

  async function deleteProfile(profile: ShippingProfile) {
    const count = usedBy(profile.id)
    if (count > 0 && !window.confirm(`${profile.name} is assigned to ${count} product/store setting(s). Deleting it removes those assignments, so those orders will show no shipping cost. Delete anyway?`)) return
    await supabase.from('shipping_profiles').delete().eq('id', profile.id)
    setStatus(`Deleted ${profile.name}.`)
    load()
  }

  function startAddBand(profile: ShippingProfile) {
    const last = profile.shipping_profile_bands[profile.shipping_profile_bands.length - 1]
    setBandProfileId(profile.id)
    setBandMin(last ? (last.max_qty === null ? '' : String(last.max_qty + 1)) : '1')
    setBandMax('')
    setBandParcels('1')
    setBandService('')
  }

  async function addBand(profile: ShippingProfile) {
    const min = parseInt(bandMin)
    const max = bandMax.trim() === '' ? null : parseInt(bandMax)
    const parcels = parseInt(bandParcels)
    if (!(min >= 1) || (max !== null && !(max >= min)) || !(parcels >= 1) || !bandService) {
      setStatus('Please enter a from-quantity (1 or more), an optional to-quantity, the number of parcels and a courier service.')
      return
    }
    if (overlapsExisting(profile.shipping_profile_bands, min, max)) {
      setStatus(`Quantities ${bandLabel({ min_qty: min, max_qty: max })} overlap a band this profile already has.`)
      return
    }
    const { error } = await supabase.from('shipping_profile_bands').insert({
      shipping_profile_id: profile.id, min_qty: min, max_qty: max, parcels, courier_service_id: bandService,
    })
    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }
    setBandProfileId(null)
    setStatus('Band added.')
    load()
  }

  async function deleteBand(id: string) {
    await supabase.from('shipping_profile_bands').delete().eq('id', id)
    setStatus('Band removed.')
    load()
  }

  function openAssign(profileId: string) {
    setAssigningId(assigningId === profileId ? null : profileId)
    setSearch('')
    setSelected(new Set())
  }

  async function assignSelected(profile: ShippingProfile) {
    const ids = Array.from(selected)
    if (ids.length === 0) {
      setStatus('Tick at least one product.')
      return
    }
    // Replace each product's all-stores profile (store overrides are left alone)
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { error: delError } = await supabase.from('product_shipping_profiles').delete().in('master_product_id', chunk).is('store_id', null)
      const { error } = delError
        ? { error: delError }
        : await supabase.from('product_shipping_profiles').insert(chunk.map((id) => ({ master_product_id: id, store_id: null, shipping_profile_id: profile.id })))
      if (error) {
        setStatus(`Error assigning: ${error.message}`)
        load()
        return
      }
    }
    setStatus(`${profile.name} assigned to ${ids.length} product(s) for all stores. Per-store exceptions are set on each product's Edit costs page.`)
    setAssigningId(null)
    load()
  }

  const shownProducts = products.filter((p) => {
    const q = search.trim().toLowerCase()
    return !q || p.standard_sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
  })

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Shipping Profiles</h1>
      <p style={pageIntro}>
        A profile describes <strong>how</strong> a type of product ships at each quantity, e.g. 1–2 units = 1 × Evri Medium, 4–5 units = 1 × DPD.
        Prices come from your <Link href="/couriers" style={{ color: lime, fontWeight: 700 }}>Couriers</Link> price list, so a courier price change never means editing profiles.
        Make one profile for everything, one per product size, or one per SKU: whatever suits you.
      </p>
      {/* Bands aren't dated yet (roadmap: date-tracked courier changes), so a courier change rewrites history */}
      <p style={{ color: amber, fontSize: '13px', fontWeight: 600, margin: '12px 0 0', maxWidth: '720px', lineHeight: 1.5 }}>
        ⚠ Changing a profile&apos;s courier (e.g. switching from Evri to DPD) applies to all past orders too, not just new ones.
        Only change it to fix a mistake. Support for switching couriers from a date is coming soon.
      </p>
      {status && <p style={{ color: lime, fontSize: '14px', fontWeight: 600, marginTop: '16px' }}>{status}</p>}

      {!loading && services.length === 0 && (
        <div style={{ ...cardStyle, borderColor: amber }}>
          <p style={{ color: amber, margin: 0, fontSize: '14px' }}>
            Add your courier services on the <Link href="/couriers" style={{ color: amber, fontWeight: 700 }}>Couriers</Link> page first. Profiles are built from them.
          </p>
        </div>
      )}

      <div style={cardStyle}>
        <p style={cardTitle}>New profile</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input placeholder="e.g. Large garden item" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} style={{ ...inputStyle, width: '260px' }} />
          <button onClick={addProfile} style={primaryButton}>Create</button>
        </div>
      </div>

      {loading && <p style={{ color: muted, marginTop: '20px' }}>Loading...</p>}

      {profiles.map((profile) => {
        const bands = profile.shipping_profile_bands
        const warnings = bandWarnings(bands)
        return (
          <div key={profile.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
              {renamingId === profile.id ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} style={{ ...inputStyle, width: '240px' }} />
                  <button onClick={() => renameProfile(profile.id)} style={linkButton}>Save</button>
                  <button onClick={() => setRenamingId(null)} style={{ ...linkButton, color: muted }}>Cancel</button>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: text }}>
                  {profile.name}
                  <span style={{ fontSize: '13px', fontWeight: 600, color: muted, marginLeft: '10px' }}>used by {usedBy(profile.id)} product/store setting(s)</span>
                </p>
              )}
              <div>
                <button onClick={() => openAssign(profile.id)} style={linkButton}>{assigningId === profile.id ? 'Close' : 'Assign to products'}</button>
                <button onClick={() => { setRenamingId(profile.id); setRenameValue(profile.name) }} style={{ ...linkButton, color: muted }}>Rename</button>
                <button onClick={() => deleteProfile(profile)} style={{ ...linkButton, color: red }}>Delete</button>
              </div>
            </div>

            {bands.length > 0 && (
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Quantity</th>
                    <th style={thStyle}>Ships as</th>
                    <th style={thStyle}>Cost today</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b) => {
                    const service = serviceById.get(b.courier_service_id)
                    const price = priceOn(service, today())
                    return (
                      <tr key={b.id}>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{bandLabel(b)}</td>
                        <td style={tdStyle}>{b.parcels} × {service?.name || '?'}</td>
                        <td style={tdStyle}>
                          {price ? pounds(b.parcels * price.price_pence) : <span style={{ color: red }}>no price yet</span>}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <button onClick={() => deleteBand(b.id)} style={{ ...linkButton, color: red }}>Remove</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {warnings.map((w) => (
              <p key={w} style={{ color: amber, fontSize: '13px', margin: '10px 0 0' }}>⚠ {w}</p>
            ))}

            {bandProfileId === profile.id ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '14px' }}>
                <span style={{ fontSize: '13px', color: muted }}>Qty</span>
                <input placeholder="from" value={bandMin} onChange={(e) => setBandMin(e.target.value)} style={{ ...inputStyle, width: '70px' }} />
                <span style={{ fontSize: '13px', color: muted }}>to</span>
                <input placeholder="and above" value={bandMax} onChange={(e) => setBandMax(e.target.value)} style={{ ...inputStyle, width: '100px' }} />
                <span style={{ fontSize: '13px', color: muted }}>ships as</span>
                <input value={bandParcels} onChange={(e) => setBandParcels(e.target.value)} style={{ ...inputStyle, width: '55px' }} />
                <span style={{ fontSize: '13px', color: muted }}>×</span>
                <select value={bandService} onChange={(e) => setBandService(e.target.value)} style={inputStyle}>
                  <option value="">Courier service...</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={() => addBand(profile)} style={primaryButton}>Add band</button>
                <button onClick={() => setBandProfileId(null)} style={{ ...linkButton, color: muted }}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => startAddBand(profile)} style={{ ...linkButton, padding: 0, marginTop: '14px' }}>+ Add quantity band</button>
            )}

            {assigningId === profile.id && (
              <div style={{ marginTop: '18px', borderTop: `1px solid ${border}`, paddingTop: '16px' }}>
                <p style={{ ...cardTitle, margin: '0 0 10px' }}>Assign {profile.name} to products (all stores)</p>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <input placeholder="Search SKU or name" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, width: '240px' }} />
                  <button onClick={() => setSelected(new Set([...selected, ...shownProducts.map((p) => p.id)]))} style={linkButton}>Tick all shown</button>
                  <button onClick={() => setSelected(new Set())} style={{ ...linkButton, color: muted }}>Clear</button>
                  <button onClick={() => assignSelected(profile)} style={{ ...primaryButton, marginLeft: 'auto' }}>Assign to {selected.size} product(s)</button>
                </div>
                <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <tbody>
                      {shownProducts.slice(0, 500).map((p) => {
                        const current = defaultProfileOf.get(p.id)
                        return (
                          <tr key={p.id}>
                            <td style={{ ...tdStyle, width: '30px' }}>
                              <input
                                type="checkbox"
                                checked={selected.has(p.id)}
                                onChange={(e) => {
                                  const next = new Set(selected)
                                  if (e.target.checked) next.add(p.id)
                                  else next.delete(p.id)
                                  setSelected(next)
                                }}
                              />
                            </td>
                            <td style={{ ...tdStyle, fontWeight: 700 }}>{p.standard_sku}</td>
                            <td style={tdStyle}>{p.name}</td>
                            <td style={{ ...tdStyle, color: current ? muted : amber, fontSize: '13px' }}>
                              {current ? `currently: ${profileById.get(current)?.name || '?'}` : 'no profile'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {shownProducts.length > 500 && <p style={{ color: muted, fontSize: '13px' }}>Showing the first 500. Search to narrow down.</p>}
                </div>
              </div>
            )}
          </div>
        )
      })}

      <NextStep href="/products" label="Add your products" text="Next, add your products: each one gets its store SKUs, costs and one of these shipping profiles." />
    </div>
  )
}
