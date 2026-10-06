'use client'

import { Fragment, useEffect, useState } from 'react'
import NextStep from '@/components/NextStep'
import { supabase } from '@/lib/supabase'
import { loadStores, Store } from '@/lib/stores'
import { ukDate } from '@/lib/format'
import { lime, red, amber, muted, dim, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, inputStyle, primaryButton, linkButton, statusColor } from '@/lib/theme'

type Platform = { id: string; name: string }
type VatRow = { id: string; store_id: string; vat_registered: boolean; effective_from: string }

// The starting row every store gets ("from the beginning")
const FROM_START = '2000-01-01'
const today = () => new Date().toISOString().slice(0, 10)
const fromLabel = (date: string) => (date === FROM_START ? 'From the start' : `From ${ukDate(date)}`)
const vatLabel = (registered: boolean) => (registered ? 'VAT registered' : 'Not VAT registered')

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([])
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [vatRows, setVatRows] = useState<VatRow[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')

  // New store form
  const [newName, setNewName] = useState('')
  const [newPlatformId, setNewPlatformId] = useState('')
  const [newVatRegistered, setNewVatRegistered] = useState(true)
  const [newFulfilledByChannel, setNewFulfilledByChannel] = useState(false)

  // Renaming a store
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  // VAT history panel (one store at a time)
  const [vatOpenId, setVatOpenId] = useState<string | null>(null)
  const [changeDate, setChangeDate] = useState(today())
  const [changeRegistered, setChangeRegistered] = useState(true)
  const [editingVatId, setEditingVatId] = useState<string | null>(null)
  const [editVatDate, setEditVatDate] = useState('')
  const [editVatRegistered, setEditVatRegistered] = useState(true)

  async function loadAll() {
    const [storeList, { data: platformData }, { data: vatData }] = await Promise.all([
      loadStores(),
      supabase.from('platforms').select('id, name').order('name'),
      supabase.from('store_vat_status').select('id, store_id, vat_registered, effective_from').order('effective_from'),
    ])
    setStores(storeList)
    setPlatforms(platformData || [])
    setVatRows(vatData || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  const historyOf = (storeId: string) => vatRows.filter((v) => v.store_id === storeId)
  // Status today: the latest change on or before today
  const currentOf = (storeId: string) => historyOf(storeId).filter((v) => v.effective_from <= today()).pop()

  async function createStore() {
    if (!newName || !newPlatformId) {
      setStatus('Please enter a store name and choose a platform.')
      return
    }
    const { error } = await supabase.from('stores').insert({
      // tenant_id is filled in by the database (the logged-in user's tenant); the database
      // also starts the store's VAT history from this setting
      platform_id: newPlatformId,
      name: newName,
      vat_registered: newVatRegistered,
      fulfilled_by_channel: newFulfilledByChannel,
    })
    if (error) {
      // 23505 = a store with this name already exists on this channel
      setStatus(
        error.code === '23505'
          ? `Error: you already have a store called "${newName}" on this channel. Use a different name` +
            (newFulfilledByChannel ? `, e.g. "${newName} FBA", so the two are easy to tell apart on the dashboards.` : '.')
          : `Error creating store: ${error.message}`
      )
      return
    }
    setNewName('')
    setNewPlatformId('')
    setNewVatRegistered(true)
    setNewFulfilledByChannel(false)
    setStatus('Store created.')
    loadAll()
  }

  async function saveName(id: string) {
    if (!editName) {
      setStatus('Store name cannot be empty.')
      return
    }
    const { error } = await supabase.from('stores').update({ name: editName }).eq('id', id)
    if (error) {
      setStatus(`Error saving: ${error.message}`)
      return
    }
    setEditingId(null)
    setStatus('Store renamed.')
    loadAll()
  }

  // Who ships this store's orders. Not dated: it applies to all of the store's orders.
  async function toggleFulfilment(store: Store) {
    const next = !store.fulfilled_by_channel
    if (!window.confirm(next
      ? `Mark ${store.name} as fulfilled by the channel (e.g. Amazon FBA)? Its orders will have no shipping cost of your own (the channel's fulfilment fee is in its fees). This applies to all of its orders.`
      : `Mark ${store.name} as shipped by you? Its orders will use your shipping profiles and rules again. This applies to all of its orders.`)) return
    const { error } = await supabase.from('stores').update({ fulfilled_by_channel: next }).eq('id', store.id)
    setStatus(error ? `Error saving: ${error.message}` : `${store.name}: ${next ? 'fulfilled by the channel' : 'shipped by you'}.`)
    loadAll()
  }

  function openVat(store: Store) {
    setVatOpenId(vatOpenId === store.id ? null : store.id)
    setEditingVatId(null)
    setChangeDate(today())
    setChangeRegistered(!(currentOf(store.id)?.vat_registered ?? store.vat_registered))
  }

  // A genuine change from a date: only orders from that date use the new status
  async function addVatChange(store: Store) {
    if (!changeDate) {
      setStatus('Please choose the date the change applies from.')
      return
    }
    const { error } = await supabase.from('store_vat_status').insert({
      tenant_id: store.tenant_id,
      store_id: store.id,
      vat_registered: changeRegistered,
      effective_from: changeDate,
    })
    if (error) {
      setStatus(error.code === '23505' ? `There's already a change on ${ukDate(changeDate)} for this store: edit that one instead.` : `Error saving: ${error.message}`)
      return
    }
    setStatus(`${store.name}: ${vatLabel(changeRegistered).toLowerCase()} from ${ukDate(changeDate)}. Orders before that date are unchanged.`)
    loadAll()
  }

  function startEditVat(row: VatRow) {
    setEditingVatId(row.id)
    setEditVatDate(row.effective_from)
    setEditVatRegistered(row.vat_registered)
  }

  // A correction: changes every order this entry covers, past and future
  async function saveVatEdit(row: VatRow) {
    if (!editVatDate) {
      setStatus('Please choose a date.')
      return
    }
    if (!window.confirm('This corrects a mistake, so it recalculates margins for every order this entry covers, including past ones. Continue?')) return
    const { error } = await supabase.from('store_vat_status').update({ vat_registered: editVatRegistered, effective_from: editVatDate }).eq('id', row.id)
    if (error) {
      setStatus(error.code === '23505' ? 'There\'s already a change on that date for this store.' : `Error saving: ${error.message}`)
      return
    }
    setEditingVatId(null)
    setStatus('VAT history corrected. Margins for the orders it covers have been recalculated.')
    loadAll()
  }

  async function deleteVatRow(row: VatRow) {
    if (!window.confirm(`Remove the change from ${ukDate(row.effective_from)}? Orders from that date go back to the status before it.`)) return
    const { error } = await supabase.from('store_vat_status').delete().eq('id', row.id)
    setStatus(error ? `Error removing: ${error.message}` : 'Change removed.')
    loadAll()
  }

  const cancelButton: React.CSSProperties = { ...linkButton, color: muted }
  const help: React.CSSProperties = { color: muted, fontSize: '13px', lineHeight: 1.5, margin: '0 0 10px' }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Stores</h1>
      <p style={pageIntro}>
        Each store is one shop on one platform, e.g. separate TikTok shops per brand, or Amazon UK and Amazon FR.
        The store name is what appears on the dashboards.
      </p>
      {status && <p style={{ color: statusColor(status), fontSize: '14px', fontWeight: 600, marginTop: '16px' }}>{status}</p>}

      <div style={cardStyle}>
        <p style={cardTitle}>Add a store</p>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input placeholder="Store name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: '220px' }} />
          <select value={newPlatformId} onChange={(e) => setNewPlatformId(e.target.value)} style={inputStyle}>
            <option value="">Platform...</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <label style={{ fontSize: '14px', color: muted }}>
            <input type="checkbox" checked={newVatRegistered} onChange={(e) => setNewVatRegistered(e.target.checked)} /> VAT registered
          </label>
          <label style={{ fontSize: '14px', color: muted }}>
            <input type="checkbox" checked={newFulfilledByChannel} onChange={(e) => setNewFulfilledByChannel(e.target.checked)} /> Fulfilled by the channel (e.g. Amazon FBA)
          </label>
          <button onClick={createStore} style={primaryButton}>
            Add
          </button>
        </div>
        <p style={{ ...help, margin: '10px 0 0' }}>
          If the business becomes VAT registered later, add the date it changed under the store&apos;s VAT button below.
          For Amazon FBA, add a separate store (e.g. &quot;Amazon UK FBA&quot;) with &quot;Fulfilled by the channel&quot; ticked: the Amazon
          import sends FBA orders there from the same settlement file, so FBA and your own shipping compare side by side.
        </p>
      </div>

      <div style={cardStyle}>
        {loading ? (
          <p style={{ color: muted, fontSize: '14px', margin: 0 }}>Loading...</p>
        ) : stores.length === 0 ? (
          <p style={{ color: muted, fontSize: '14px', margin: 0 }}>No stores yet. Add one above before importing.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thStyle}>Store</th>
                <th style={thStyle}>Platform</th>
                <th style={thStyle}>VAT</th>
                <th style={thStyle}>Shipping</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => {
                const history = historyOf(s.id)
                const current = currentOf(s.id)
                const registered = current?.vat_registered ?? s.vat_registered
                const upcoming = history.filter((v) => v.effective_from > today())
                return (
                  <Fragment key={s.id}>
                    <tr>
                      <td style={tdStyle}>
                        {editingId === s.id ? (
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, width: '200px' }} />
                        ) : s.name}
                      </td>
                      <td style={tdStyle}>{s.platforms?.name}</td>
                      <td style={tdStyle}>
                        {vatLabel(registered)}
                        {current && current.effective_from !== FROM_START && <span style={{ color: muted, fontSize: '13px' }}> · from {ukDate(current.effective_from)}</span>}
                        {upcoming.map((u) => (
                          <div key={u.id} style={{ color: amber, fontSize: '12px' }}>{vatLabel(u.vat_registered)} from {ukDate(u.effective_from)}</div>
                        ))}
                      </td>
                      <td style={tdStyle}>
                        {s.fulfilled_by_channel ? 'Channel ships (e.g. FBA)' : 'You ship'}{' '}
                        <button onClick={() => toggleFulfilment(s)} style={{ ...linkButton, fontSize: '12px' }}>Change</button>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {editingId === s.id ? (
                          <>
                            <button onClick={() => saveName(s.id)} style={linkButton}>Save</button>
                            <button onClick={() => setEditingId(null)} style={cancelButton}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditingId(s.id); setEditName(s.name) }} style={linkButton}>Rename</button>
                            <button onClick={() => openVat(s)} style={linkButton}>{vatOpenId === s.id ? 'Close VAT' : 'VAT'}</button>
                          </>
                        )}
                      </td>
                    </tr>
                    {vatOpenId === s.id && (
                      <tr>
                        <td colSpan={5} style={{ ...tdStyle, background: 'rgba(255,255,255,0.03)', padding: '16px' }}>
                          <p style={{ ...help, color: text, fontWeight: 700 }}>VAT history for {s.name}</p>
                          <p style={help}>
                            Each order uses the VAT status on its own date. Registered: sales, costs, fees and shipping are counted without VAT.
                            Not registered: VAT is a cost, so everything is counted including VAT.
                          </p>
                          {history.map((row, i) => (
                            <div key={row.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '14px', margin: '0 0 6px' }}>
                              {editingVatId === row.id ? (
                                <>
                                  {i === 0 ? (
                                    <span style={{ color: muted }}>From the start:</span>
                                  ) : (
                                    <input type="date" value={editVatDate} onChange={(e) => setEditVatDate(e.target.value)} style={inputStyle} />
                                  )}
                                  <select value={editVatRegistered ? '1' : '0'} onChange={(e) => setEditVatRegistered(e.target.value === '1')} style={inputStyle}>
                                    <option value="1">VAT registered</option>
                                    <option value="0">Not VAT registered</option>
                                  </select>
                                  <button onClick={() => saveVatEdit(row)} style={linkButton}>Save correction</button>
                                  <button onClick={() => setEditingVatId(null)} style={cancelButton}>Cancel</button>
                                </>
                              ) : (
                                <>
                                  <span style={{ color: muted, minWidth: '130px' }}>{fromLabel(row.effective_from)}</span>
                                  <strong>{vatLabel(row.vat_registered)}</strong>
                                  <button onClick={() => startEditVat(row)} style={linkButton}>Edit</button>
                                  {i > 0 && <button onClick={() => deleteVatRow(row)} style={{ ...linkButton, color: red }}>Remove</button>}
                                </>
                              )}
                            </div>
                          ))}
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '14px' }}>
                            <span style={{ fontSize: '14px', color: text }}>Became</span>
                            <select value={changeRegistered ? '1' : '0'} onChange={(e) => setChangeRegistered(e.target.value === '1')} style={inputStyle}>
                              <option value="1">VAT registered</option>
                              <option value="0">Not VAT registered</option>
                            </select>
                            <span style={{ fontSize: '14px', color: text }}>from</span>
                            <input type="date" value={changeDate} onChange={(e) => setChangeDate(e.target.value)} style={inputStyle} />
                            <button onClick={() => addVatChange(s)} style={primaryButton}>Add change</button>
                          </div>
                          <p style={{ ...help, margin: '10px 0 0' }}>
                            <strong style={{ color: text }}>Add change</strong> = a real change on a date (e.g. you registered for VAT): only orders from that date are affected.{' '}
                            <strong style={{ color: text }}>Edit</strong> = fix a mistake: it recalculates every order that entry covers, including past ones.
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
        <p style={{ color: dim, fontSize: '12px', marginBottom: 0, marginTop: '14px' }}>
          Overheads use each store&apos;s VAT status as of today.
        </p>
      </div>

      <NextStep href="/couriers" label="Add your couriers" text="Next, the courier services you use and their prices, so shipping costs can be worked out." />
    </div>
  )
}
