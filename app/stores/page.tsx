'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { loadStores, Store } from '@/lib/stores'

type Platform = { id: string; name: string }

export default function StoresPage() {
  const [stores, setStores] = useState<Store[]>([])
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')

  // New store form
  const [newName, setNewName] = useState('')
  const [newPlatformId, setNewPlatformId] = useState('')
  const [newVatRegistered, setNewVatRegistered] = useState(true)

  // Editing an existing store
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editVatRegistered, setEditVatRegistered] = useState(true)

  async function loadAll() {
    setStores(await loadStores())
    const { data } = await supabase.from('platforms').select('id, name').order('name')
    setPlatforms(data || [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [])

  async function createStore() {
    if (!newName || !newPlatformId) {
      setStatus('Please enter a store name and choose a platform.')
      return
    }
    const { data: tenant } = await supabase.from('tenants').select('id').eq('name', 'Test Store').single()
    const { error } = await supabase.from('stores').insert({
      tenant_id: tenant?.id,
      platform_id: newPlatformId,
      name: newName,
      vat_registered: newVatRegistered,
    })
    if (error) {
      setStatus(`Error creating store: ${error.message}`)
      return
    }
    setNewName('')
    setNewPlatformId('')
    setNewVatRegistered(true)
    setStatus('Store created.')
    loadAll()
  }

  async function saveEdit(id: string) {
    if (!editName) {
      setStatus('Store name cannot be empty.')
      return
    }
    const { error } = await supabase
      .from('stores')
      .update({ name: editName, vat_registered: editVatRegistered })
      .eq('id', id)
    if (error) {
      setStatus(`Error saving: ${error.message}`)
      return
    }
    setEditingId(null)
    setStatus('Store updated.')
    loadAll()
  }

  const pageStyle: React.CSSProperties = {
    background: '#1A1A1A',
    minHeight: '100vh',
    padding: '2rem',
    fontFamily: 'sans-serif',
    color: '#fff',
  }
  const cardStyle: React.CSSProperties = {
    background: '#232323',
    borderRadius: '12px',
    border: '0.5px solid #333',
    padding: '20px',
    marginTop: '1.5rem',
  }
  const thStyle: React.CSSProperties = { padding: '8px', textAlign: 'left', color: '#888', fontWeight: 500, fontSize: '13px', borderBottom: '0.5px solid #333' }
  const tdStyle: React.CSSProperties = { padding: '8px', color: '#eee', fontSize: '14px', borderBottom: '0.5px solid #2e2e2e' }
  const inputStyle: React.CSSProperties = { padding: '6px', background: '#1A1A1A', color: '#fff', border: '0.5px solid #444', borderRadius: '6px' }
  const linkButton: React.CSSProperties = { color: '#DCFF00', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px' }

  return (
    <div style={{ background: '#1A1A1A', minHeight: '100vh' }}>
      <div style={pageStyle}>
        <span style={{ fontSize: '18px', fontWeight: 500 }}>Stores</span>
        <p style={{ color: '#888', fontSize: '13px', marginTop: '4px' }}>
          Each store is one shop on one platform, e.g. separate TikTok shops per brand, or Amazon UK and Amazon FR.
          The store name is what appears on the dashboards.
        </p>
        {status && <p style={{ color: '#DCFF00', fontSize: '13px' }}>{status}</p>}

        <div style={cardStyle}>
          <span style={{ fontSize: '14px', fontWeight: 500 }}>Add a store</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
            <input placeholder="Store name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: '220px' }} />
            <select value={newPlatformId} onChange={(e) => setNewPlatformId(e.target.value)} style={inputStyle}>
              <option value="">Platform...</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <label style={{ fontSize: '13px', color: '#bbb' }}>
              <input type="checkbox" checked={newVatRegistered} onChange={(e) => setNewVatRegistered(e.target.checked)} /> VAT registered
            </label>
            <button onClick={createStore} style={{ padding: '6px 14px', background: '#DCFF00', color: '#1A1A1A', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
              Add
            </button>
          </div>
        </div>

        <div style={cardStyle}>
          {loading ? (
            <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>Loading...</p>
          ) : stores.length === 0 ? (
            <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>No stores yet. Add one above before importing.</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Store</th>
                  <th style={thStyle}>Platform</th>
                  <th style={thStyle}>VAT registered</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {stores.map((s) =>
                  editingId === s.id ? (
                    <tr key={s.id}>
                      <td style={tdStyle}>
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, width: '200px' }} />
                      </td>
                      <td style={tdStyle}>{s.platforms?.name}</td>
                      <td style={tdStyle}>
                        <input type="checkbox" checked={editVatRegistered} onChange={(e) => setEditVatRegistered(e.target.checked)} />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <button onClick={() => saveEdit(s.id)} style={linkButton}>Save</button>
                        <button onClick={() => setEditingId(null)} style={{ ...linkButton, color: '#888' }}>Cancel</button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={s.id}>
                      <td style={tdStyle}>{s.name}</td>
                      <td style={tdStyle}>{s.platforms?.name}</td>
                      <td style={tdStyle}>{s.vat_registered ? 'Yes' : 'No'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <button
                          onClick={() => {
                            setEditingId(s.id)
                            setEditName(s.name)
                            setEditVatRegistered(s.vat_registered)
                          }}
                          style={linkButton}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
          <p style={{ color: '#888', fontSize: '12px', marginBottom: 0, marginTop: '12px' }}>
            Note: changing VAT registration recalculates margins for all of that store's orders, past and future.
          </p>
        </div>
      </div>
    </div>
  )
}
