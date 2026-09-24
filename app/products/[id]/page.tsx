'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Product = {
  id: string
  standard_sku: string
  name: string
  vat_rate: number
}

type CogsRow = {
  id: string
  component_type: string
  amount_pence: number
  vat_rate: number
  effective_from: string
}

type ShippingRow = {
  id: string
  qty: number
  courier_cost_pence: number
  vat_rate: number
  service_level: string
  effective_from: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function ProductDetailPage() {
  const params = useParams()
  const productId = params.id as string

  const [product, setProduct] = useState<Product | null>(null)
  const [cogs, setCogs] = useState<CogsRow[]>([])
  const [shipping, setShipping] = useState<ShippingRow[]>([])
  const [status, setStatus] = useState('')

  const [newComponentType, setNewComponentType] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newVatRate, setNewVatRate] = useState('')
  const [newEffectiveFrom, setNewEffectiveFrom] = useState(today())
  const [newQty, setNewQty] = useState('')
  const [newShippingCost, setNewShippingCost] = useState('')
  const [newShippingVat, setNewShippingVat] = useState('')
  const [newServiceLevel, setNewServiceLevel] = useState('standard')
  const [newShippingEffectiveFrom, setNewShippingEffectiveFrom] = useState(today())

  const [editingCogsId, setEditingCogsId] = useState<string | null>(null)
  const [editComponentType, setEditComponentType] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editVatRate, setEditVatRate] = useState('')

  const [editingShippingId, setEditingShippingId] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [editShippingCost, setEditShippingCost] = useState('')
  const [editShippingVat, setEditShippingVat] = useState('')
  const [editServiceLevel, setEditServiceLevel] = useState('standard')

  async function loadAll() {
    const { data: productData } = await supabase
      .from('master_products')
      .select('id, standard_sku, name, vat_rate')
      .eq('id', productId)
      .single()
    setProduct(productData)

    const { data: cogsData } = await supabase
      .from('cogs_components')
      .select('id, component_type, amount_pence, vat_rate, effective_from')
      .eq('master_product_id', productId)
      .order('component_type')
    setCogs(cogsData || [])

    const { data: shippingData } = await supabase
      .from('shipping_rules')
      .select('id, qty, courier_cost_pence, vat_rate, service_level, effective_from')
      .eq('master_product_id', productId)
      .order('qty')
    setShipping(shippingData || [])
  }

  useEffect(() => {
    loadAll()
  }, [productId])

  async function updateProductVatRate(rate: number) {
    await supabase.from('master_products').update({ vat_rate: rate }).eq('id', productId)
    setStatus('Product default VAT rate updated.')
    loadAll()
  }

  async function addCogsRow() {
    if (!newComponentType || !newAmount || newVatRate === '' || !newEffectiveFrom) {
      setStatus('Please enter a component type, amount, VAT rate, and effective date.')
      return
    }
    const { error } = await supabase.from('cogs_components').insert({
      master_product_id: productId,
      component_type: newComponentType,
      amount_pence: Math.round(parseFloat(newAmount) * 100),
      vat_rate: parseFloat(newVatRate),
      effective_from: newEffectiveFrom,
    })
    if (error) {
      setStatus(`Error adding cost: ${error.message}`)
      return
    }
    setNewComponentType('')
    setNewAmount('')
    setNewVatRate('')
    setNewEffectiveFrom(today())
    setStatus('Cost added.')
    loadAll()
  }

  function startEditCogs(row: CogsRow) {
    setEditingCogsId(row.id)
    setEditComponentType(row.component_type)
    setEditAmount((row.amount_pence / 100).toString())
    setEditVatRate(row.vat_rate.toString())
  }

  async function saveCogsEdit(id: string) {
    const { error } = await supabase
      .from('cogs_components')
      .update({
        component_type: editComponentType,
        amount_pence: Math.round(parseFloat(editAmount) * 100),
        vat_rate: parseFloat(editVatRate),
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
    })
    if (error) {
      setStatus(`Error adding shipping rule: ${error.message}`)
      return
    }
    setNewQty('')
    setNewShippingCost('')
    setNewShippingVat('')
    setNewShippingEffectiveFrom(today())
    setStatus('Shipping rule added.')
    loadAll()
  }

  function startEditShipping(row: ShippingRow) {
    setEditingShippingId(row.id)
    setEditQty(row.qty.toString())
    setEditShippingCost((row.courier_cost_pence / 100).toString())
    setEditShippingVat(row.vat_rate.toString())
    setEditServiceLevel(row.service_level)
  }

  async function saveShippingEdit(id: string) {
    const { error } = await supabase
      .from('shipping_rules')
      .update({
        qty: parseInt(editQty),
        courier_cost_pence: Math.round(parseFloat(editShippingCost) * 100),
        vat_rate: parseFloat(editShippingVat),
        service_level: editServiceLevel,
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

  if (!product) return <div style={{ padding: '2rem' }}>Loading...</div>

  const thStyle = { padding: '8px', textAlign: 'left' as const, borderBottom: '2px solid #ccc' }
  const tdStyle = { padding: '8px' }
  const inputStyle = { padding: '4px', width: '90px' }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '950px' }}>
      <h1>{product.name} <span style={{ color: '#888', fontWeight: 'normal' }}>({product.standard_sku})</span></h1>
      {status && <p style={{ color: '#2563eb' }}>{status}</p>}

      <section style={{ marginTop: '1.5rem' }}>
        <h2>Default VAT Rate</h2>
        <p style={{ color: '#666', fontSize: '14px' }}>Used as a suggested default for forecasting — not applied retroactively to costs already entered below.</p>
        <select
          value={product.vat_rate}
          onChange={(e) => updateProductVatRate(parseFloat(e.target.value))}
          style={{ padding: '6px' }}
        >
          <option value="0">0% (VAT-free / zero-rated)</option>
          <option value="0.20">20% (Standard rate)</option>
        </select>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Cost Components (COGS)</h2>
        <p style={{ color: '#666', fontSize: '13px' }}>
          <strong>Edit</strong> corrects a mistake — it changes margin for every order using this cost, past and future.
          To reflect a genuine price change from today onward while keeping historical accuracy, use <strong>Add Cost</strong> below instead of editing.
        </p>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>VAT Rate</th>
              <th style={thStyle}>Effective From</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {cogs.map((row) =>
              editingCogsId === row.id ? (
                <tr key={row.id} style={{ borderBottom: '1px solid #eee', background: '#fafafa' }}>
                  <td style={tdStyle}>
                    <input value={editComponentType} onChange={(e) => setEditComponentType(e.target.value)} style={inputStyle} />
                  </td>
                  <td style={tdStyle}>
                    <input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} style={inputStyle} />
                  </td>
                  <td style={tdStyle}>
                    <select value={editVatRate} onChange={(e) => setEditVatRate(e.target.value)} style={{ padding: '4px' }}>
                      <option value="0">0%</option>
                      <option value="0.20">20%</option>
                    </select>
                  </td>
                  <td style={tdStyle}>{row.effective_from}</td>
                  <td style={tdStyle}>
                    <button onClick={() => saveCogsEdit(row.id)} style={{ marginRight: '8px' }}>Save</button>
                    <button onClick={() => setEditingCogsId(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={tdStyle}>{row.component_type}</td>
                  <td style={tdStyle}>£{(row.amount_pence / 100).toFixed(2)}</td>
                  <td style={tdStyle}>{(row.vat_rate * 100).toFixed(0)}%</td>
                  <td style={tdStyle}>{row.effective_from}</td>
                  <td style={tdStyle}>
                    <button onClick={() => startEditCogs(row)} style={{ marginRight: '12px', color: '#2563eb', border: 'none', background: 'none', cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button onClick={() => deleteCogsRow(row.id)} style={{ color: '#dc2626', border: 'none', background: 'none', cursor: 'pointer' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>

        <div style={{ marginTop: '1rem', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Type (e.g. cost_price, picking)"
            value={newComponentType}
            onChange={(e) => setNewComponentType(e.target.value)}
            style={{ padding: '6px', width: '180px' }}
          />
          <input
            placeholder="Amount £"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            style={{ padding: '6px', width: '100px' }}
          />
          <select value={newVatRate} onChange={(e) => setNewVatRate(e.target.value)} style={{ padding: '6px' }}>
            <option value="">Select VAT rate...</option>
            <option value="0">0% (VAT-free / labour / zero-rated)</option>
            <option value="0.20">20% (Standard rate)</option>
          </select>
          <div>
            <input
              type="date"
              value={newEffectiveFrom}
              onChange={(e) => setNewEffectiveFrom(e.target.value)}
              style={{ padding: '6px' }}
            />
            <div style={{ fontSize: '11px', color: '#888' }}>Effective from — today for a new price, or an earlier date if backfilling history</div>
          </div>
          <button onClick={addCogsRow} style={{ padding: '6px 12px' }}>Add Cost</button>
        </div>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Shipping Rules</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thStyle}>Qty</th>
              <th style={thStyle}>Cost</th>
              <th style={thStyle}>VAT Rate</th>
              <th style={thStyle}>Service Level</th>
              <th style={thStyle}>Effective From</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {shipping.map((row) =>
              editingShippingId === row.id ? (
                <tr key={row.id} style={{ borderBottom: '1px solid #eee', background: '#fafafa' }}>
                  <td style={tdStyle}>
                    <input value={editQty} onChange={(e) => setEditQty(e.target.value)} style={{ ...inputStyle, width: '50px' }} />
                  </td>
                  <td style={tdStyle}>
                    <input value={editShippingCost} onChange={(e) => setEditShippingCost(e.target.value)} style={inputStyle} />
                  </td>
                  <td style={tdStyle}>
                    <select value={editShippingVat} onChange={(e) => setEditShippingVat(e.target.value)} style={{ padding: '4px' }}>
                      <option value="0">0%</option>
                      <option value="0.20">20%</option>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <select value={editServiceLevel} onChange={(e) => setEditServiceLevel(e.target.value)} style={{ padding: '4px' }}>
                      <option value="standard">Standard</option>
                      <option value="express">Express</option>
                    </select>
                  </td>
                  <td style={tdStyle}>{row.effective_from}</td>
                  <td style={tdStyle}>
                    <button onClick={() => saveShippingEdit(row.id)} style={{ marginRight: '8px' }}>Save</button>
                    <button onClick={() => setEditingShippingId(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={tdStyle}>{row.qty}</td>
                  <td style={tdStyle}>£{(row.courier_cost_pence / 100).toFixed(2)}</td>
                  <td style={tdStyle}>{(row.vat_rate * 100).toFixed(0)}%</td>
                  <td style={tdStyle}>{row.service_level}</td>
                  <td style={tdStyle}>{row.effective_from}</td>
                  <td style={tdStyle}>
                    <button onClick={() => startEditShipping(row)} style={{ marginRight: '12px', color: '#2563eb', border: 'none', background: 'none', cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button onClick={() => deleteShippingRow(row.id)} style={{ color: '#dc2626', border: 'none', background: 'none', cursor: 'pointer' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>

        <p style={{ color: '#666', fontSize: '13px' }}>
          If the courier price genuinely changes, use <strong>Add Rule</strong> with today's date — past orders keep the old rate, future orders use the new one.
          Use <strong>Edit</strong> on an existing row only to fix a mistake (it changes every order using that rule, past and future).
        </p>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="Qty"
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
            style={{ padding: '6px', width: '60px' }}
          />
          <input
            placeholder="Cost £"
            value={newShippingCost}
            onChange={(e) => setNewShippingCost(e.target.value)}
            style={{ padding: '6px', width: '100px' }}
          />
          <select value={newShippingVat} onChange={(e) => setNewShippingVat(e.target.value)} style={{ padding: '6px' }}>
            <option value="">Select VAT rate...</option>
            <option value="0">0%</option>
            <option value="0.20">20%</option>
          </select>
          <select value={newServiceLevel} onChange={(e) => setNewServiceLevel(e.target.value)} style={{ padding: '6px' }}>
            <option value="standard">Standard</option>
            <option value="express">Express</option>
          </select>
          <div>
            <input
              type="date"
              value={newShippingEffectiveFrom}
              onChange={(e) => setNewShippingEffectiveFrom(e.target.value)}
              style={{ padding: '6px' }}
            />
            <div style={{ fontSize: '11px', color: '#888' }}>Effective from</div>
          </div>
          <button onClick={addShippingRow} style={{ padding: '6px 12px' }}>Add Rule</button>
        </div>
      </section>
    </div>
  )
}
