'use client'

import { ukDate } from '@/lib/format'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { loadStores, Store, storeLabel } from '@/lib/stores'
import {
  loadOverheadSetup, Overhead, AllocationBasis, CATEGORIES, FREQUENCIES, BASES,
  overheadInRange, perDayPence, lastDay, describeSchedule, addDays,
} from '@/lib/overheads'
import { lime, red, amber, muted, dim, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, inputStyle, primaryButton, linkButton } from '@/lib/theme'

type Setup = Awaited<ReturnType<typeof loadOverheadSetup>>

const today = () => new Date().toISOString().slice(0, 10)
const pounds = (pence: number) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const validAmount = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0
const toPence = (v: string) => Math.round(Number(v) * 100)

export default function OverheadsPage() {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [revenue30, setRevenue30] = useState(0)
  const [status, setStatus] = useState('')
  const [showEnded, setShowEnded] = useState(false)

  // Add form
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [storeId, setStoreId] = useState('')
  const [kind, setKind] = useState<'recurring' | 'one_off'>('recurring')
  const [frequency, setFrequency] = useState('monthly')
  const [spreadMonths, setSpreadMonths] = useState('1')
  const [amount, setAmount] = useState('')
  const [vat, setVat] = useState('')
  const [startDate, setStartDate] = useState(today())
  const [endDate, setEndDate] = useState('')

  // Row actions
  const [changingId, setChangingId] = useState<string | null>(null)
  const [changeAmount, setChangeAmount] = useState('')
  const [changeFrom, setChangeFrom] = useState(today())
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [stopDate, setStopDate] = useState(today())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editVat, setEditVat] = useState('')

  async function load() {
    const s = await loadOverheadSetup()
    setSetup(s)
    setStores(await loadStores())
    const { data } = await fetchAll((from, to) =>
      supabase.from('order_margins').select('revenue_pence').gte('order_date', addDays(today(), -29)).lte('order_date', today()).order('order_line_item_id').range(from, to)
    )
    setRevenue30(data.reduce((sum, r) => sum + (Number(r.revenue_pence) || 0), 0))
  }

  useEffect(() => {
    load()
  }, [])

  async function setBasis(basis: AllocationBasis) {
    if (!setup?.tenantId) return
    const { error } = await supabase.from('tenants').update({ overhead_allocation_basis: basis }).eq('id', setup.tenantId)
    if (error) {
      setStatus(`Error saving setting: ${error.message}`)
      return
    }
    setStatus(`Overheads are now shared by ${BASES.find((b) => b.code === basis)?.label.toLowerCase()}.`)
    load()
  }

  async function addOverhead() {
    if (!name.trim() || !category || !validAmount(amount) || vat === '' || !startDate) {
      setStatus('Please fill in name, category, amount, VAT rate and start date.')
      return
    }
    if (kind === 'one_off' && !(parseInt(spreadMonths) >= 1)) {
      setStatus('Spread over must be 1 month or more.')
      return
    }
    if (kind === 'recurring' && endDate && endDate < startDate) {
      setStatus('The end date is before the start date.')
      return
    }
    const { error } = await supabase.from('overheads').insert({
      tenant_id: setup?.tenantId,
      store_id: storeId || null,
      name: name.trim(),
      category,
      amount_pence: toPence(amount),
      vat_rate: parseFloat(vat),
      kind,
      frequency: kind === 'recurring' ? frequency : null,
      spread_months: kind === 'one_off' ? parseInt(spreadMonths) : null,
      start_date: startDate,
      end_date: kind === 'recurring' && endDate ? endDate : null,
    })
    if (error) {
      setStatus(`Error adding overhead: ${error.message}`)
      return
    }
    setStatus(`Added ${name.trim()}.`)
    setName('')
    setAmount('')
    setVat('')
    setEndDate('')
    load()
  }

  // Genuine change: end the old amount the day before, start the new one (history kept)
  async function changeAmountFrom(o: Overhead) {
    if (!validAmount(changeAmount) || !changeFrom || changeFrom <= o.start_date) {
      setStatus(`Enter the new amount and a start date after ${ukDate(o.start_date)}.`)
      return
    }
    const { error: endError } = await supabase.from('overheads').update({ end_date: addDays(changeFrom, -1) }).eq('id', o.id)
    if (endError) {
      setStatus(`Error: ${endError.message}`)
      return
    }
    const { error } = await supabase.from('overheads').insert({
      tenant_id: setup?.tenantId,
      store_id: o.store_id,
      name: o.name,
      category: o.category,
      amount_pence: toPence(changeAmount),
      vat_rate: o.vat_rate,
      kind: o.kind,
      frequency: o.frequency,
      spread_months: o.spread_months,
      start_date: changeFrom,
      end_date: o.end_date,
    })
    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }
    setChangingId(null)
    setChangeAmount('')
    setStatus(`${o.name} changes to £${Number(changeAmount).toFixed(2)} from ${ukDate(changeFrom)}. Earlier periods keep the old amount.`)
    load()
  }

  async function stopFrom(o: Overhead) {
    if (!stopDate || stopDate < o.start_date) {
      setStatus(`The last day must be on or after ${ukDate(o.start_date)}.`)
      return
    }
    const { error } = await supabase.from('overheads').update({ end_date: stopDate }).eq('id', o.id)
    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }
    setStoppingId(null)
    setStatus(`${o.name} stops after ${ukDate(stopDate)}.`)
    load()
  }

  async function saveEdit(o: Overhead) {
    if (!editName.trim() || !validAmount(editAmount)) {
      setStatus('Please enter a name and a valid amount.')
      return
    }
    const { error } = await supabase.from('overheads').update({ name: editName.trim(), amount_pence: toPence(editAmount), vat_rate: parseFloat(editVat) }).eq('id', o.id)
    if (error) {
      setStatus(`Error: ${error.message}`)
      return
    }
    setEditingId(null)
    setStatus('Corrected. This changes every period this overhead covers, past and future.')
    load()
  }

  async function remove(o: Overhead) {
    if (!window.confirm(`Delete ${o.name}? It will be removed from all periods, past and future. To stop it from a date instead, use Stop.`)) return
    await supabase.from('overheads').delete().eq('id', o.id)
    setStatus(`Deleted ${o.name}.`)
    load()
  }

  if (!setup) return <div style={pageStyle}><p style={{ color: muted }}>Loading...</p></div>

  const t = today()
  const isActive = (o: Overhead) => o.start_date <= t && (lastDay(o) === null || lastDay(o)! >= t)
  const isEnded = (o: Overhead) => lastDay(o) !== null && lastDay(o)! < t
  const shown = setup.overheads.filter((o) => showEnded || !isEnded(o))
  const netFor = (o: Overhead) => (o.store_id ? !!setup.storeVat.get(o.store_id) : setup.businessVatRegistered)
  const last30 = setup.overheads.reduce((sum, o) => sum + overheadInRange(o, addDays(t, -29), t, netFor(o)), 0)
  const monthlyRunRate = setup.overheads.filter(isActive).reduce((sum, o) => sum + (perDayPence(o, netFor(o)) * 365) / 12, 0)
  // Live explanation of what an amount (entered inc. VAT) counts as, so it's clear the VAT is taken off when registered
  const vatPreview = (amountText: string, vatText: string, netOfVat: boolean) => {
    if (!validAmount(amountText) || vatText === '') return null
    const gross = toPence(amountText)
    const vatPence = Math.round((gross * Number(vatText)) / (1 + Number(vatText)))
    if (vatPence === 0) return `${pounds(gross)} counted (no VAT on this).`
    return netOfVat
      ? `${pounds(gross)} inc. VAT = ${pounds(gross - vatPence)} + ${pounds(vatPence)} VAT. VAT registered, so ${pounds(gross - vatPence)} is counted (you reclaim the VAT).`
      : `Not VAT registered, so the full ${pounds(gross)} is counted (the ${pounds(vatPence)} VAT is a cost to you).`
  }
  const vatSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
      <option value="">VAT rate...</option>
      <option value="0">0% (wages, rent without VAT, rates, insurance)</option>
      <option value="0.05">5%</option>
      <option value="0.2">20%</option>
    </select>
  )

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Overheads</h1>
      <p style={pageIntro}>
        Costs that can&apos;t be tied to one order: wages, rent, rates, utilities, subscriptions, equipment. Each one becomes a cost per day and is
        shared across your sales, so you can see <strong>Net Profit after overheads</strong>. They never affect Gross Profit.
      </p>
      {status && <p style={{ color: lime, fontSize: '14px', fontWeight: 600, marginTop: '16px' }}>{status}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginTop: '20px' }}>
        {[
          { label: 'Monthly run rate (current)', value: pounds(monthlyRunRate) },
          { label: 'Overheads, last 30 days', value: pounds(last30) },
          { label: 'As % of revenue, last 30 days', value: revenue30 > 0 ? `${((last30 / revenue30) * 100).toFixed(1)}%` : '—' },
        ].map((k) => (
          <div key={k.label} style={{ ...cardStyle, marginTop: 0 }}>
            <p style={{ ...cardTitle, margin: '0 0 8px' }}>{k.label}</p>
            <p style={{ fontSize: '26px', fontWeight: 800, margin: 0 }}>{k.value}</p>
          </div>
        ))}
      </div>
      <p style={{ fontSize: '12px', color: dim, margin: '8px 0 0' }}>
        Ex. VAT where the business (or store) is VAT registered. With revenue sharing, every product&apos;s margin drops by roughly the % shown above.
      </p>

      <div style={cardStyle}>
        <p style={cardTitle}>How overheads are shared across sales</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {BASES.map((b) => (
            <label key={b.code} style={{ fontSize: '14px', cursor: 'pointer', color: text }}>
              <input type="radio" name="basis" checked={setup.basis === b.code} onChange={() => setBasis(b.code)} style={{ marginRight: '8px' }} />
              <strong>{b.label}</strong> <span style={{ color: muted }}>— {b.explain}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={cardStyle}>
        <p style={cardTitle}>Add an overhead</p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Name, e.g. Warehouse rent" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, width: '220px' }} />
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
            <option value="">Category...</option>
            {CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} style={inputStyle}>
            <option value="">Whole business</option>
            {stores.map((s) => <option key={s.id} value={s.id}>Only {storeLabel(s)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginTop: '10px' }}>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'recurring' | 'one_off')} style={inputStyle}>
            <option value="recurring">Recurring</option>
            <option value="one_off">One-off (spread over months)</option>
          </select>
          {kind === 'recurring' ? (
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} style={inputStyle}>
              {FREQUENCIES.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
            </select>
          ) : (
            <label style={{ fontSize: '13px', color: muted }}>
              spread over <input value={spreadMonths} onChange={(e) => setSpreadMonths(e.target.value)} style={{ ...inputStyle, width: '60px', margin: '0 6px' }} /> months
            </label>
          )}
          <input placeholder="£ inc. VAT" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, width: '120px' }} />
          {vatSelect(vat, setVat)}
          <label style={{ fontSize: '13px', color: muted }}>
            {kind === 'recurring' ? 'from' : 'on'} <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ ...inputStyle, marginLeft: '6px' }} />
          </label>
          {kind === 'recurring' && (
            <label style={{ fontSize: '13px', color: muted }}>
              until <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ ...inputStyle, marginLeft: '6px' }} />
              <span style={{ marginLeft: '6px' }}>(optional)</span>
            </label>
          )}
          <button onClick={addOverhead} style={primaryButton}>Add</button>
        </div>
        {vatPreview(amount, vat, storeId ? !!setup.storeVat.get(storeId) : setup.businessVatRegistered) && (
          <p style={{ fontSize: '13px', color: text, margin: '10px 0 0' }}>
            {vatPreview(amount, vat, storeId ? !!setup.storeVat.get(storeId) : setup.businessVatRegistered)}
          </p>
        )}
        <p style={{ fontSize: '12px', color: dim, margin: '10px 0 0' }}>
          Enter the amount <strong style={{ color: muted }}>including VAT</strong>, i.e. what you actually pay, per {kind === 'recurring' ? 'payment (e.g. per month)' : 'purchase'}. If you&apos;re VAT registered, the VAT is taken off for you.
          {kind === 'one_off' && ' Spread big purchases over their useful life, e.g. a machine over 36 months, so one month doesn\'t look like a disaster.'}
        </p>
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
          <p style={{ ...cardTitle, margin: 0 }}>Your overheads</p>
          <label style={{ fontSize: '13px', color: muted, cursor: 'pointer' }}>
            <input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} style={{ marginRight: '6px' }} />
            Show ended
          </label>
        </div>
        {shown.length === 0 ? (
          <p style={{ color: muted, fontSize: '14px', margin: 0 }}>No overheads yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '820px' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Applies to</th>
                  <th style={thStyle}>Schedule</th>
                  <th style={thStyle}>≈ per month</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => {
                  const ended = isEnded(o)
                  const future = o.start_date > t
                  return [
                    <tr key={o.id} style={{ opacity: ended ? 0.5 : 1 }}>
                      <td style={tdStyle}>
                        {editingId === o.id ? (
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, width: '180px' }} />
                        ) : (
                          <>
                            <strong>{o.name}</strong>
                            <div style={{ fontSize: '12px', color: muted }}>{CATEGORIES.find((c) => c.code === o.category)?.label}</div>
                          </>
                        )}
                      </td>
                      <td style={tdStyle}>{o.store_id ? storeLabel(stores.find((s) => s.id === o.store_id)) : 'Whole business'}</td>
                      <td style={{ ...tdStyle, fontSize: '13px' }}>
                        {editingId === o.id ? (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <input placeholder="£ inc. VAT" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} style={{ ...inputStyle, width: '110px' }} />
                            {vatSelect(editVat, setEditVat)}
                            <div style={{ fontSize: '12px', color: muted, width: '100%' }}>{vatPreview(editAmount, editVat, netFor(o)) ?? 'Amount including VAT.'}</div>
                          </div>
                        ) : (
                          <>
                            {describeSchedule(o)}
                            <span style={{ color: muted }}> · {o.vat_rate > 0 ? `inc. ${(o.vat_rate * 100).toFixed(0)}% VAT` : 'no VAT'}</span>
                            {ended && <span style={{ color: dim }}> · ended</span>}
                            {future && <span style={{ color: amber }}> · starts {ukDate(o.start_date)}</span>}
                          </>
                        )}
                      </td>
                      <td style={tdStyle}>{pounds((perDayPence(o, netFor(o)) * 365) / 12)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {editingId === o.id ? (
                          <>
                            <button onClick={() => saveEdit(o)} style={linkButton}>Save</button>
                            <button onClick={() => setEditingId(null)} style={{ ...linkButton, color: muted }}>Cancel</button>
                          </>
                        ) : (
                          <>
                            {o.kind === 'recurring' && !ended && (
                              <>
                                <button onClick={() => { setChangingId(changingId === o.id ? null : o.id); setStoppingId(null) }} style={linkButton}>Change amount</button>
                                <button onClick={() => { setStoppingId(stoppingId === o.id ? null : o.id); setChangingId(null) }} style={linkButton}>Stop</button>
                              </>
                            )}
                            <button onClick={() => { setEditingId(o.id); setEditName(o.name); setEditAmount((o.amount_pence / 100).toFixed(2)); setEditVat(String(o.vat_rate)) }} style={{ ...linkButton, color: muted }}>Edit (fix mistake)</button>
                            <button onClick={() => remove(o)} style={{ ...linkButton, color: red }}>Delete</button>
                          </>
                        )}
                      </td>
                    </tr>,
                    changingId === o.id && (
                      <tr key={`${o.id}-change`}>
                        <td colSpan={5} style={{ ...tdStyle, background: 'rgba(255,255,255,0.02)' }}>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '13px', color: muted }}>New amount</span>
                            <input placeholder="£ inc. VAT" value={changeAmount} onChange={(e) => setChangeAmount(e.target.value)} style={{ ...inputStyle, width: '110px' }} />
                            <label style={{ fontSize: '13px', color: muted }}>
                              from <input type="date" value={changeFrom} onChange={(e) => setChangeFrom(e.target.value)} style={{ ...inputStyle, marginLeft: '6px' }} />
                            </label>
                            <button onClick={() => changeAmountFrom(o)} style={primaryButton}>Save change</button>
                            <span style={{ fontSize: '12px', color: dim }}>Earlier periods keep the old amount.</span>
                          </div>
                        </td>
                      </tr>
                    ),
                    stoppingId === o.id && (
                      <tr key={`${o.id}-stop`}>
                        <td colSpan={5} style={{ ...tdStyle, background: 'rgba(255,255,255,0.02)' }}>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '13px', color: muted }}>
                              Last day it applies <input type="date" value={stopDate} onChange={(e) => setStopDate(e.target.value)} style={{ ...inputStyle, marginLeft: '6px' }} />
                            </label>
                            <button onClick={() => stopFrom(o)} style={primaryButton}>Stop</button>
                          </div>
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
