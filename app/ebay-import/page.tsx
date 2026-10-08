'use client'

import { useState } from 'react'
import { importOrdersForStore, importResultSummary, NormalizedOrder } from '@/lib/importEngine'
import ConfirmImport from '@/components/ConfirmImport'
import { readSpreadsheet, toIsoDate } from '@/lib/readSpreadsheet'
import { Store } from '@/lib/stores'
import { FeeLine, addFee, feeTotals, shareVat } from '@/lib/fees'
import { pounds, ukDate } from '@/lib/format'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, statusColor } from '@/lib/theme'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// eBay writes "31-Jul-26"; an Excel date cell is already "2026-07-31"; also accepts 31/07/2026
function parseEbayDate(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2}|\d{4})\b/)
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1
    if (!month) return null
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return toIsoDate(`${m[1]}/${month}/${year}`)
  }
  return toIsoDate(value)
}

// "--" means empty in eBay's report
const toPence = (value: string | undefined) => Math.round((parseFloat(value || '') || 0) * 100)

// The fee columns. eBay's own file has a dash in "Final value fee – fixed" that often comes
// through garbled, so columns are found by pattern and the label is tidied up.
// "Final value fee – variable" is eBay's commission; the rest are other eBay fees.
function feeColumns(headers: string[]) {
  return headers
    .filter((h) => /fee/i.test(h))
    .map((h) => ({
      column: h,
      label: h.replace(/[^\x20-\x7E]+/g, '-').replace(/\s+/g, ' ').trim(),
      type: /^final value fee.*variable/i.test(h) ? ('commission' as const) : ('other_fee' as const),
    }))
}

type Parsed = NormalizedOrder & { orderNumber: string; netAmountPence: number }

export default function EbayImportPage() {
  const [store, setStore] = useState<Store | null>(null)
  const [createUnknownSkus, setCreateUnknownSkus] = useState(false)
  const [status, setStatus] = useState('')
  const [allOrders, setAllOrders] = useState<Parsed[]>([])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!store) {
      setStatus('Please select which store this report is from first.')
      return
    }

    setStatus('Reading file...')
    let rows: Record<string, string>[]
    try {
      // The report starts with a block of notes; the table starts at the "Transaction creation date" row
      rows = await readSpreadsheet(file, ['Transaction creation date'], { headerStartsWith: 'Transaction creation date' })
    } catch (err) {
      setStatus(`Error: this doesn't look like an eBay transaction report (${err instanceof Error ? err.message : err}).`)
      return
    }
    if (rows.length > 0 && !('Type' in rows[0] && 'Custom label' in rows[0] && 'Item subtotal' in rows[0])) {
      setStatus('Error: this doesn\'t look like an eBay transaction report (no "Type" / "Custom label" / "Item subtotal" columns).')
      return
    }
    const fees = feeColumns(Object.keys(rows[0] || {}))

    const parsed: Parsed[] = []
    const otherTypes = new Map<string, number>() // refunds, postage labels, other fees... handled later
    const noSkuItems: string[] = [] // Item IDs of sales with no Custom label
    let badRows = 0
    let mismatched = 0
    for (const row of rows) {
      const type = (row['Type'] || '').trim()
      if (type !== 'Order') {
        if (type) otherTypes.set(type, (otherTypes.get(type) || 0) + 1)
        continue
      }
      const sku = (row['Custom label'] || '').trim()
      if (!sku || sku === '--') {
        noSkuItems.push(row['Item ID'] || '?')
        continue
      }
      const orderNumber = (row['Order number'] || '').trim()
      const transactionId = (row['Transaction ID'] || '').trim()
      const orderDate = parseEbayDate(row['Transaction creation date'] || '')
      const itemsPence = toPence(row['Item subtotal'])
      if (!orderNumber || !orderDate || itemsPence <= 0) {
        badRows++
        continue
      }
      const postagePence = toPence(row['Postage and packaging'])

      // Fees are negative in the file and include 20% VAT (per eBay's notes), so the VAT is 1/6
      const feeBreakdown: FeeLine[] = []
      for (const fee of fees) addFee(feeBreakdown, fee.type, fee.label, -toPence(row[fee.column]))
      const feesGrossPence = feeTotals(feeBreakdown).grossPence
      const feesVatPence = Math.round(feesGrossPence / 6)
      shareVat(feeBreakdown, feesVatPence)

      // Check our reading of the row against eBay's own payout figure
      const netAmountPence = toPence(row['Net amount'])
      if (Math.abs(itemsPence + postagePence - feesGrossPence - netAmountPence) > 1) mismatched++

      parsed.push({
        sku,
        // One Transaction ID per item sold, so a multi-item order gives one line per item
        externalId: transactionId && transactionId !== '--' ? transactionId : orderNumber,
        orderNumber,
        orderDate,
        qty: parseInt(row['Quantity']) || 1,
        salePriceGrossPence: itemsPence,
        saleVatPence: null, // worked out from the product's VAT rate
        feesGrossPence,
        feesVatPence,
        feeBreakdown,
        actualShippingCostPence: null, // eBay postage labels come later: shipping rules / profiles are used
        shippingRevenueGrossPence: postagePence,
        shippingRevenueVatPence: null,
        netAmountPence,
      })
    }

    setAllOrders(parsed)
    setStatus(
      `Found ${parsed.length} order lines.` +
      (otherTypes.size
        ? ` Skipped rows that aren't sales (handled later): ${Array.from(otherTypes, ([t, n]) => `${n} ${t}`).join(', ')}.`
        : '') +
      (noSkuItems.length
        ? ` Warning: held back ${noSkuItems.length} sale(s) with no Custom label (eBay's SKU), Item IDs: ${noSkuItems.slice(0, 10).join(', ')}${noSkuItems.length > 10 ? ' and more' : ''}. Add a Custom label to those listings in eBay Seller Hub (each variation needs its own), then download the report again.`
        : '') +
      (badRows ? ` Warning: skipped ${badRows} sale row(s) with no order number, date or item price.` : '') +
      (mismatched ? ` Warning: ${mismatched} row(s) don't add up to eBay's Net amount, please check them.` : '') +
      ' Review below, then confirm.'
    )
  }

  async function handleImport(progress: (message: string) => void) {
    if (allOrders.length === 0) {
      return 'Nothing to import yet: please choose a file first.'
    }
    if (!store) {
      return 'Please select which store this report is from first.'
    }
    const result = await importOrdersForStore(store, allOrders, progress, { createUnknownSkus })
    return [importResultSummary(result, store)]
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>eBay Import</h1>
      <p style={pageIntro}>
        Upload the eBay transaction report (CSV or Excel) from Seller Hub → Payments → Reports. Products are matched on the
        Custom label (your SKU), so every listing and variation needs one. Sales only for now: refunds, postage labels and
        Promoted Listings fees come later.
      </p>

      <div style={cardStyle}>
        <StorePicker platformFilter={(p) => p.integration_type === 'ebay'} value={store} onChange={setStore} />
        <CreateProductsToggle checked={createUnknownSkus} onChange={setCreateUnknownSkus} />

        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '16px', display: 'block' }} />
        {status && <p style={{ color: statusColor(status), fontSize: '14px', fontWeight: 600, margin: '16px 0 0', lineHeight: 1.5 }}>{status}</p>}
      </div>

      {allOrders.length > 0 && (
        <div style={cardStyle}>
          <p style={cardTitle}>Preview</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Order</th>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Item subtotal</th>
                  <th style={thStyle}>Postage</th>
                  <th style={thStyle}>Fees (inc. VAT)</th>
                  <th style={thStyle}>Net amount</th>
                </tr>
              </thead>
              <tbody>
                {allOrders.slice(0, 20).map((row) => (
                  <tr key={row.externalId + row.sku}>
                    <td style={tdStyle}>{row.orderNumber}</td>
                    <td style={tdStyle}>{row.sku}</td>
                    <td style={tdStyle}>{ukDate(row.orderDate)}</td>
                    <td style={tdStyle}>{row.qty}</td>
                    <td style={tdStyle}>{pounds(row.salePriceGrossPence)}</td>
                    <td style={tdStyle}>{pounds(row.shippingRevenueGrossPence ?? 0)}</td>
                    <td style={tdStyle}>{pounds(row.feesGrossPence)}</td>
                    <td style={tdStyle}>{pounds(row.netAmountPence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ConfirmImport run={handleImport} resetOn={allOrders} />
        </div>
      )}
    </div>
  )
}
