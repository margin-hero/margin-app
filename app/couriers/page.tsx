'use client'

import { ukDate } from '@/lib/format'
import NextStep from '@/components/NextStep'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { loadCourierServices, CourierService, priceOn, today, testTenantId } from '@/lib/shipping'
import { lime, red, muted, dim, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, inputStyle, primaryButton, linkButton } from '@/lib/theme'

const pounds = (pence: number) => `£${(pence / 100).toFixed(2)}`
const toPence = (value: string) => Math.round(parseFloat(value) * 100)
const validAmount = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0

export default function CouriersPage() {
  const [services, setServices] = useState<CourierService[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  // New service
  const [newName, setNewName] = useState('')
  const [newVat, setNewVat] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [newFrom, setNewFrom] = useState(today())

  // Price change (Add) on an existing service
  const [changePrice, setChangePrice] = useState('')
  const [changeFrom, setChangeFrom] = useState(today())

  // Editing (mistake correction)
  const [editServiceId, setEditServiceId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editVat, setEditVat] = useState('')
  const [editPriceId, setEditPriceId] = useState<string | null>(null)
  const [editPriceValue, setEditPriceValue] = useState('')

  async function load() {
    setServices(await loadCourierServices())
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function addService() {
    if (!newName.trim() || newVat === '' || !validAmount(newPrice) || !newFrom) {
      setStatus('Please enter a name, VAT rate, price and the date that price starts.')
      return
    }
    const tenantId = await testTenantId()
    const { data, error } = await supabase
      .from('courier_services')
      .insert({ tenant_id: tenantId, name: newName.trim(), vat_rate: parseFloat(newVat) })
      .select('id')
      .single()
    if (error || !data) {
      setStatus(`Error adding service: ${error?.message}`)
      return
    }
    const { error: priceError } = await supabase
      .from('courier_service_prices')
      .insert({ courier_service_id: data.id, price_pence: toPence(newPrice), effective_from: newFrom })
    if (priceError) {
      setStatus(`Service added, but its price failed: ${priceError.message}`)
    } else {
      setStatus(`Added ${newName.trim()}.`)
      setNewName('')
      setNewVat('')
      setNewPrice('')
      setNewFrom(today())
    }
    load()
  }

  async function addPriceChange(serviceId: string) {
    if (!validAmount(changePrice) || !changeFrom) {
      setStatus('Please enter the new price and the date it starts.')
      return
    }
    const { error } = await supabase
      .from('courier_service_prices')
      .insert({ courier_service_id: serviceId, price_pence: toPence(changePrice), effective_from: changeFrom })
    if (error) {
      setStatus(error.message.includes('duplicate') ? 'There is already a price starting on that date. Edit that one instead.' : `Error: ${error.message}`)
      return
    }
    setStatus(`New price saved from ${ukDate(changeFrom)}. Orders before then keep the old price.`)
    setChangePrice('')
    setChangeFrom(today())
    load()
  }

  async function saveService(id: string) {
    if (!editName.trim()) {
      setStatus('Name cannot be empty.')
      return
    }
    const { error } = await supabase.from('courier_services').update({ name: editName.trim(), vat_rate: parseFloat(editVat) }).eq('id', id)
    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }
    setEditServiceId(null)
    setStatus('Service updated. A VAT change applies to all orders using this service, past and future.')
    load()
  }

  async function savePrice(id: string) {
    if (!validAmount(editPriceValue)) {
      setStatus('Please enter a valid price.')
      return
    }
    const { error } = await supabase.from('courier_service_prices').update({ price_pence: toPence(editPriceValue) }).eq('id', id)
    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }
    setEditPriceId(null)
    setStatus('Price corrected. This changes every order that used it, past and future.')
    load()
  }

  async function deletePrice(service: CourierService, priceId: string) {
    if (service.courier_service_prices.length <= 1) {
      setStatus('A service needs at least one price. Delete the whole service instead.')
      return
    }
    await supabase.from('courier_service_prices').delete().eq('id', priceId)
    setStatus('Price removed.')
    load()
  }

  async function deleteService(service: CourierService) {
    const { error } = await supabase.from('courier_services').delete().eq('id', service.id)
    if (error) {
      setStatus(`Can't delete ${service.name}: it's used in a shipping profile. Change those profiles first.`)
      return
    }
    setStatus(`Deleted ${service.name}.`)
    load()
  }

  const vatSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      <option value="">VAT rate...</option>
      <option value="0">0% (e.g. Royal Mail, some couriers)</option>
      <option value="0.2">20%</option>
    </select>
  )

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Couriers</h1>
      <p style={pageIntro}>
        Your courier price list: each service and size with its price, e.g. &ldquo;Evri – Medium parcel (≤2kg)&rdquo;.
        When a courier changes its prices, <strong>add a new price with a from date</strong>. Every product using it updates, and older orders keep the old price.
        Use <strong>Edit</strong> only to fix a mistake.
      </p>
      {status && <p style={{ color: lime, fontSize: '14px', fontWeight: 600, marginTop: '16px' }}>{status}</p>}

      <div style={cardStyle}>
        <p style={cardTitle}>Add a courier service</p>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input placeholder="e.g. Evri – Medium parcel (≤2kg)" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: '280px' }} />
          {vatSelect(newVat, setNewVat)}
          <input placeholder="Price £" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} style={{ ...inputStyle, width: '100px' }} />
          <label style={{ fontSize: '13px', color: muted }}>
            from <input type="date" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} style={{ ...inputStyle, marginLeft: '6px' }} />
          </label>
          <button onClick={addService} style={primaryButton}>Add</button>
        </div>
        <p style={{ fontSize: '12px', color: dim, margin: '10px 0 0' }}>Price per parcel, including any VAT you pay. Date it on or before your oldest order it should apply to.</p>
      </div>

      <div style={cardStyle}>
        {loading ? (
          <p style={{ color: muted, fontSize: '14px', margin: 0 }}>Loading...</p>
        ) : services.length === 0 ? (
          <p style={{ color: muted, fontSize: '14px', margin: 0 }}>No courier services yet. Add your first one above.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thStyle}>Service</th>
                <th style={thStyle}>VAT</th>
                <th style={thStyle}>Price today</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => {
                const current = priceOn(s, today())
                const future = s.courier_service_prices.filter((p) => p.effective_from > today())
                const isOpen = expanded === s.id
                return [
                  <tr key={s.id}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>
                      {editServiceId === s.id ? (
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, width: '260px' }} />
                      ) : s.name}
                    </td>
                    <td style={tdStyle}>
                      {editServiceId === s.id ? vatSelect(editVat, setEditVat) : `${(s.vat_rate * 100).toFixed(0)}%`}
                    </td>
                    <td style={tdStyle}>
                      {current ? pounds(current.price_pence) : <span style={{ color: red }}>none yet</span>}
                      {future.length > 0 && <span style={{ color: muted, fontSize: '12px', marginLeft: '8px' }}>→ {pounds(future[0].price_pence)} from {ukDate(future[0].effective_from)}</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {editServiceId === s.id ? (
                        <>
                          <button onClick={() => saveService(s.id)} style={linkButton}>Save</button>
                          <button onClick={() => setEditServiceId(null)} style={{ ...linkButton, color: muted }}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setExpanded(isOpen ? null : s.id)} style={linkButton}>{isOpen ? 'Close' : 'Prices / price change'}</button>
                          <button onClick={() => { setEditServiceId(s.id); setEditName(s.name); setEditVat(String(s.vat_rate)) }} style={{ ...linkButton, color: muted }}>Edit</button>
                        </>
                      )}
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${s.id}-prices`}>
                      <td colSpan={4} style={{ ...tdStyle, background: 'rgba(255,255,255,0.02)' }}>
                        <p style={{ ...cardTitle, margin: '4px 0 10px' }}>Price history</p>
                        <table style={{ borderCollapse: 'collapse', marginBottom: '14px' }}>
                          <tbody>
                            {s.courier_service_prices.map((p) => (
                              <tr key={p.id}>
                                <td style={{ padding: '4px 16px 4px 0', color: muted, fontSize: '13px' }}>from {ukDate(p.effective_from)}</td>
                                <td style={{ padding: '4px 16px 4px 0', color: text, fontWeight: 700 }}>
                                  {editPriceId === p.id ? (
                                    <input value={editPriceValue} onChange={(e) => setEditPriceValue(e.target.value)} style={{ ...inputStyle, width: '90px' }} />
                                  ) : pounds(p.price_pence)}
                                </td>
                                <td style={{ padding: '4px 0' }}>
                                  {editPriceId === p.id ? (
                                    <>
                                      <button onClick={() => savePrice(p.id)} style={linkButton}>Save</button>
                                      <button onClick={() => setEditPriceId(null)} style={{ ...linkButton, color: muted }}>Cancel</button>
                                    </>
                                  ) : (
                                    <>
                                      <button onClick={() => { setEditPriceId(p.id); setEditPriceValue((p.price_pence / 100).toFixed(2)) }} style={{ ...linkButton, color: muted }}>Edit (fix mistake)</button>
                                      <button onClick={() => deletePrice(s, p.id)} style={{ ...linkButton, color: red }}>Delete</button>
                                    </>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '13px', color: muted }}>Price change:</span>
                          <input placeholder="New price £" value={changePrice} onChange={(e) => setChangePrice(e.target.value)} style={{ ...inputStyle, width: '110px' }} />
                          <label style={{ fontSize: '13px', color: muted }}>
                            from <input type="date" value={changeFrom} onChange={(e) => setChangeFrom(e.target.value)} style={{ ...inputStyle, marginLeft: '6px' }} />
                          </label>
                          <button onClick={() => addPriceChange(s.id)} style={primaryButton}>Add price</button>
                          <button onClick={() => deleteService(s)} style={{ ...linkButton, color: red, marginLeft: 'auto' }}>Delete service</button>
                        </div>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        )}
      </div>

      <NextStep href="/shipping-profiles" label="Create shipping profiles" text="Next, describe how your products ship at each quantity, using these courier services." />
    </div>
  )
}
