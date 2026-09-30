'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { readSpreadsheet } from '@/lib/readSpreadsheet'
import { loadCostTypes, CostType } from '@/lib/costTypes'
import { lime, red, muted, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, linkButton } from '@/lib/theme'

// One row per cost. Adds only: never edits or deletes existing costs.
const REQUIRED_COLUMNS = ['standard_sku', 'cost_type', 'amount', 'vat_rate', 'effective_from']
const TEMPLATE = [
  'standard_sku,cost_type,description,amount,vat_rate,effective_from',
  'MUG-01,Landed cost (all-in),,3.20,0,2026-01-01',
  'RAKE-3,Product cost (supplier price),,6.50,20,2026-01-01',
  'RAKE-3,Inbound freight,,0.40,20,2026-01-01',
  'RAKE-3,Import duty,,0.25,0,2026-01-01',
  'RAKE-3,Pick & pack,In-house,0.60,0,2026-01-01',
  'RAKE-3,Outer box / mailer,Large box,0.85,20,2026-01-01',
].join('\n')

type NewCost = { row: number; productId: string; sku: string; type: CostType; description: string | null; amountPence: number; vatRate: number; effectiveFrom: string }
type Problem = { row: number; message: string }
type Plan = { newCosts: NewCost[]; alreadyThere: number; problems: Problem[] }

// Accepts "20", "20%", "0.2", "0" — and nothing else, so the VAT choice is always deliberate
function parseVatRate(value: string): number | null {
  const v = value.replace('%', '').trim()
  if (v === '') return null
  const n = Number(v)
  if (n === 0) return 0
  if (n === 20 || n === 0.2) return 0.2
  if (n === 5 || n === 0.05) return 0.05
  return null
}

export default function CostImportPage() {
  const [costTypes, setCostTypes] = useState<CostType[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    loadCostTypes().then(setCostTypes)
  }, [])

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'margin-hero-costs-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPlan(null)
    setStatus('Reading file and checking against your products and existing costs...')

    let rows: Record<string, string>[]
    try {
      rows = await readSpreadsheet(file, ['effective_from'])
    } catch (err: any) {
      setStatus(`Could not read that file: ${err?.message || err}`)
      return
    }
    const missing = REQUIRED_COLUMNS.filter((c) => rows.length === 0 || !(c in rows[0]))
    if (missing.length) {
      setStatus(`The file is missing these column headings: ${missing.join(', ')}. Download the template to see the layout.`)
      return
    }

    const types = await loadCostTypes()
    // Cost type can be written as its label ("Pick & pack") or its code ("pick_pack")
    const typeByName = new Map<string, CostType>()
    types.forEach((t) => {
      typeByName.set(t.label.toLowerCase(), t)
      typeByName.set(t.code.toLowerCase(), t)
    })

    const { data: tenant } = await supabase.from('tenants').select('id').eq('name', 'Test Store').single()
    if (!tenant) {
      setStatus('Could not find the tenant.')
      return
    }
    const [products, existing] = await Promise.all([
      fetchAll((from, to) => supabase.from('master_products').select('id, standard_sku').eq('tenant_id', tenant.id).order('id').range(from, to)),
      fetchAll((from, to) =>
        supabase.from('cogs_components').select('master_product_id, component_type, description, amount_pence, effective_from').order('id').range(from, to)
      ),
    ])
    if (products.error || existing.error) {
      setStatus(`Error loading existing data: ${(products.error || existing.error)!.message}`)
      return
    }
    const productIdBySku = new Map<string, string>()
    products.data.forEach((p) => { if (!productIdBySku.has(p.standard_sku)) productIdBySku.set(p.standard_sku, p.id) })

    // Same product + type + description + start date = the same cost
    const keyOf = (productId: string, type: string, description: string | null, from: string) => `${productId}|${type}|${description || ''}|${from}`
    const existingAmount = new Map(existing.data.map((c) => [keyOf(c.master_product_id, c.component_type, c.description, c.effective_from), c.amount_pence]))

    const planned = new Map<string, NewCost>()
    const problems: Problem[] = []
    let alreadyThere = 0

    rows.forEach((r, i) => {
      const row = i + 2 // spreadsheet row number (headings are row 1)
      const sku = (r.standard_sku || '').trim()
      const typeText = (r.cost_type || '').trim()
      const description = (r.description || '').trim() || null
      const amountText = (r.amount || '').replace('£', '').replace(/,/g, '').trim()
      const vatText = (r.vat_rate || '').trim()
      const effectiveFrom = (r.effective_from || '').trim()

      if (!sku && !typeText && !amountText && !vatText && !effectiveFrom) return // blank row

      const productId = productIdBySku.get(sku)
      if (!productId) return problems.push({ row, message: `No product with standard_sku "${sku}". Add it first (Catalog Import or Mappings).` })
      const type = typeByName.get(typeText.toLowerCase())
      if (!type) return problems.push({ row, message: `Unknown cost_type "${typeText}". Use one of the names listed on this page.` })
      const amount = Number(amountText)
      if (amountText === '' || !Number.isFinite(amount) || amount < 0) return problems.push({ row, message: `amount "${r.amount}" isn't a valid amount in pounds.` })
      const vatRate = parseVatRate(vatText)
      if (vatRate === null) return problems.push({ row, message: `vat_rate "${vatText}" must be 0, 5 or 20 (a deliberate choice per cost, so it can't be left empty).` })
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return problems.push({ row, message: `effective_from "${effectiveFrom}" must be a date written as YYYY-MM-DD (or an Excel date cell).` })

      const amountPence = Math.round(amount * 100)
      const key = keyOf(productId, type.code, description, effectiveFrom)
      const existingPence = existingAmount.get(key)
      if (existingPence !== undefined) {
        if (existingPence === amountPence) {
          alreadyThere++
          return
        }
        return problems.push({ row, message: `${sku} already has "${type.label}"${description ? ` (${description})` : ''} from ${effectiveFrom} at £${(existingPence / 100).toFixed(2)}. Not changed: to correct it use Edit costs, or for a genuine price change use a new effective_from date.` })
      }
      const earlier = planned.get(key)
      if (earlier) {
        if (earlier.amountPence !== amountPence) {
          problems.push({ row, message: `Same product, cost type, description and date as row ${earlier.row} but a different amount.` })
        }
        return
      }
      planned.set(key, { row, productId, sku, type, description, amountPence, vatRate, effectiveFrom })
    })

    const result: Plan = { newCosts: Array.from(planned.values()), alreadyThere, problems }
    setPlan(result)
    setStatus(
      `Ready: ${result.newCosts.length} new cost(s). ${result.alreadyThere} row(s) already there. ` +
      (result.problems.length ? `${result.problems.length} row(s) have problems and will be skipped (listed below).` : 'No problems found.')
    )
  }

  async function handleImport() {
    if (!plan) return
    setBusy(true)
    for (let i = 0; i < plan.newCosts.length; i += 500) {
      setStatus(`Saving costs (${i + 1}–${Math.min(i + 500, plan.newCosts.length)} of ${plan.newCosts.length})...`)
      const { error } = await supabase.from('cogs_components').insert(
        plan.newCosts.slice(i, i + 500).map((c) => ({
          master_product_id: c.productId,
          component_type: c.type.code,
          description: c.description,
          amount_pence: c.amountPence,
          vat_rate: c.vatRate,
          effective_from: c.effectiveFrom,
        }))
      )
      if (error) {
        setStatus(`Error saving costs: ${error.message}. Choose the file again to retry — costs already saved will show as "already there".`)
        setBusy(false)
        return
      }
    }
    setStatus(
      `Done. Added ${plan.newCosts.length} cost(s).` +
      (plan.problems.length ? ` ${plan.problems.length} row(s) with problems were skipped.` : '') +
      ' Check the Costs page for anything still missing.'
    )
    setPlan(null)
    setBusy(false)
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Cost Import</h1>
      <p style={pageIntro}>
        Add product costs in bulk. This only ever <strong>adds</strong> costs. It never edits or deletes existing ones,
        so your history stays intact. To correct a mistake, use Edit costs on the product.
      </p>

      <div style={cardStyle}>
        <p style={cardTitle}>File layout</p>
        <p style={{ fontSize: '14px', color: muted, margin: '0 0 12px', lineHeight: 1.6 }}>
          CSV or Excel, <strong style={{ color: text }}>one row per cost</strong>. Columns: <code>standard_sku</code>, <code>cost_type</code>,{' '}
          <code>description</code> (optional), <code>amount</code> (£, including any VAT you pay), <code>vat_rate</code> (0, 5 or 20, required),{' '}
          <code>effective_from</code> (YYYY-MM-DD, required: date it before your oldest order it should apply to).
        </p>
        <button onClick={downloadTemplate} style={{ ...linkButton, padding: 0 }}>Download template ↓</button>
        <div style={{ marginTop: '18px' }}>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} disabled={busy} style={{ color: muted, fontSize: '14px' }} />
        </div>
        {status && <p style={{ color: lime, fontSize: '14px', fontWeight: 600, margin: '16px 0 0' }}>{status}</p>}
        {plan && plan.newCosts.length > 0 && (
          <button onClick={handleImport} disabled={busy} style={{ ...primaryButton, marginTop: '18px', opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Importing...' : 'Confirm import'}
          </button>
        )}
        {status.startsWith('Done') && (
          <p style={{ margin: '12px 0 0' }}><Link href="/costs" style={{ color: lime, fontWeight: 700, fontSize: '14px' }}>Go to Costs →</Link></p>
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

      {plan && plan.newCosts.length > 0 && (
        <div style={cardStyle}>
          <p style={cardTitle}>New costs ({plan.newCosts.length})</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '640px' }}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU</th><th style={thStyle}>Cost type</th><th style={thStyle}>Description</th>
                  <th style={thStyle}>Amount</th><th style={thStyle}>VAT</th><th style={thStyle}>From</th>
                </tr>
              </thead>
              <tbody>
                {plan.newCosts.slice(0, 50).map((c) => (
                  <tr key={c.row}>
                    <td style={tdStyle}>{c.sku}</td>
                    <td style={tdStyle}>{c.type.label} <span style={{ color: muted, fontSize: '12px' }}>{c.type.basis === 'per_order' ? 'per order' : 'per unit'}</span></td>
                    <td style={tdStyle}>{c.description || ''}</td>
                    <td style={tdStyle}>£{(c.amountPence / 100).toFixed(2)}</td>
                    <td style={tdStyle}>{c.vatRate * 100}%</td>
                    <td style={tdStyle}>{c.effectiveFrom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.newCosts.length > 50 && <p style={{ color: muted, fontSize: '13px' }}>...and {plan.newCosts.length - 50} more.</p>}
        </div>
      )}

      {costTypes.length > 0 && (
        <div style={cardStyle}>
          <p style={cardTitle}>Cost types you can use</p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {costTypes.map((t) => (
                <tr key={t.code}>
                  <td style={{ ...tdStyle, fontWeight: 700, whiteSpace: 'nowrap' }}>{t.label}</td>
                  <td style={{ ...tdStyle, color: muted, whiteSpace: 'nowrap' }}>{t.basis === 'per_order' ? 'per order' : 'per unit'}{t.in_gross ? ' · landed' : ''}</td>
                  <td style={{ ...tdStyle, color: muted, fontSize: '13px' }}>{t.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
