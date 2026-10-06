'use client'

import { ukDate } from '@/lib/format'
import { useState } from 'react'
import { readSpreadsheet, toIsoDate } from '@/lib/readSpreadsheet'
import { importOrdersForStore, describeImportResult, NormalizedOrder } from '@/lib/importEngine'
import { Store } from '@/lib/stores'
import { FeeLine, FeeType, addFee, feeTotals, shareVat } from '@/lib/fees'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, statusColor } from '@/lib/theme'

type AmazonRow = {
  'transaction-type': string
  'order-id': string
  'order-item-code': string
  'amount-type': string
  'amount-description': string
  amount: string
  sku: string
  'quantity-purchased': string
  'posted-date': string
}

// Amazon's own file says e.g. "31.08.2026 10:12:13 UTC"; once saved from Excel it may be
// a date cell (read as 2026-08-31) or 31/08/2026. All UK day-first.
function parseAmazonDate(dateStr: string): string {
  return toIsoDate(dateStr) ?? ''
}

// Sorts Amazon's fee names (the "amount-description" of ItemFees rows) into fee types.
// Anything not listed here is kept under its own name as "Other channel fees".
function amazonFeeType(description: string): FeeType {
  if (/commission/i.test(description)) return 'commission' // Commission (referral fee), RefundCommission
  if (/^FBA|fulfil/i.test(description)) return 'fulfilment' // FBAPerUnitFulfillmentFee, FBAWeightBasedFee...
  if (/^Shipping/i.test(description)) return 'shipping' // ShippingChargeback, ShippingHB
  return 'other_fee' // e.g. VariableClosingFee, FixedClosingFee, DigitalServicesFee, GiftwrapChargeback
}

export default function AmazonImportPage() {
  const [status, setStatus] = useState<string>('')
  const [preview, setPreview] = useState<NormalizedOrder[]>([])
  const [allOrders, setAllOrders] = useState<NormalizedOrder[]>([])
  const [store, setStore] = useState<Store | null>(null)
  const [createUnknownSkus, setCreateUnknownSkus] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setStatus('Reading file, this may take a moment for large files...')

    // Amazon's settlement report is tab-separated text (.txt); .csv and Excel (.xlsx) work too
    let data: AmazonRow[]
    try {
      data = (await readSpreadsheet(file, ['posted-date'])) as unknown as AmazonRow[]
    } catch (err) {
      setStatus(`Error reading file: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    const orderRows = data.filter((row) => row['transaction-type'] === 'Order')

    const groups = new Map<string, AmazonRow[]>()
    for (const row of orderRows) {
      const key = row['order-item-code']
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(row)
    }

    const shippingByOrderId = new Map<string, number>()
    for (const row of data) {
      if (
        row['transaction-type'] === 'other-transaction' &&
        row['amount-description'] === 'Shipping label purchase'
      ) {
        const orderId = row['order-id']
        const amt = Math.abs(parseFloat(row.amount))
        shippingByOrderId.set(orderId, (shippingByOrderId.get(orderId) || 0) + amt)
      }
    }

    const normalized: NormalizedOrder[] = []
    for (const [orderItemCode, rows] of groups) {
      const first = rows[0]
      let principal = 0
      let tax = 0
      const feeBreakdown: FeeLine[] = []

      for (const row of rows) {
        const amt = parseFloat(row.amount)
        if (row['amount-type'] === 'ItemPrice' && row['amount-description'] === 'Principal') {
          principal += amt
        } else if (row['amount-type'] === 'ItemPrice' && row['amount-description'] === 'Tax') {
          tax += amt
        } else if (row['amount-type'] === 'ItemFees') {
          const description = row['amount-description'] || 'Amazon fee'
          addFee(feeBreakdown, amazonFeeType(description), description, Math.round(Math.abs(amt) * 100))
        }
      }

      const feesGrossPence = feeTotals(feeBreakdown).grossPence
      // Amazon doesn't give the VAT on fees, so it's taken as 20% of the total and shared across the fees
      const feesVatPence = Math.round(feesGrossPence - feesGrossPence / 1.2)
      shareVat(feeBreakdown, feesVatPence)
      const orderId = first['order-id']

      normalized.push({
        sku: first.sku,
        externalId: orderItemCode,
        orderDate: parseAmazonDate(first['posted-date']),
        qty: parseInt(first['quantity-purchased']) || 1,
        salePriceGrossPence: Math.round((principal + tax) * 100),
        saleVatPence: Math.round(tax * 100),
        feesGrossPence,
        feesVatPence,
        feeBreakdown,
        actualShippingCostPence: shippingByOrderId.has(orderId)
          ? Math.round(shippingByOrderId.get(orderId)! * 100)
          : null,
      })
    }

    // A date that couldn't be read would put the sale on the wrong day, so stop here
    const badDates = normalized.filter((o) => !o.orderDate).length
    if (badDates > 0) {
      setAllOrders([])
      setPreview([])
      setStatus(`Error: ${badDates} order line(s) have a posted-date that couldn't be read. Expected a UK date like 31.08.2026 or 31/08/2026.`)
      return
    }

    setAllOrders(normalized)
    setPreview(normalized.slice(0, 20))
    setStatus(`Found ${normalized.length} order lines (from ${orderRows.length} rows in the file). Showing first 20 below — review, then confirm import.`)
  }

  async function handleImport() {
    if (allOrders.length === 0) {
      setStatus('Nothing to import yet: please choose a file first.')
      return
    }
    if (!store) {
      setStatus('Please choose which store this file is from first.')
      return
    }

    const result = await importOrdersForStore(store, allOrders, setStatus, { createUnknownSkus })
    setStatus(describeImportResult(result, store))
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>Amazon Import</h1>
      <p style={pageIntro}>First pass: standard sales only (Refunds and SAFE-T reimbursements are skipped for now).</p>
      <div style={cardStyle}>
      <StorePicker platformFilter={(p) => p.name.startsWith('Amazon')} value={store} onChange={setStore} />
      <CreateProductsToggle checked={createUnknownSkus} onChange={setCreateUnknownSkus} />
      <input type="file" accept=".txt,.tsv,.csv,.xlsx,.xls" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '16px', display: 'block' }} />
      {status && <p style={{ color: statusColor(status), fontSize: '14px', fontWeight: 600, margin: '16px 0 0', lineHeight: 1.5 }}>{status}</p>}
      </div>

      {preview.length > 0 && (
        <div style={cardStyle}>
          <p style={cardTitle}>Preview</p>
          <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thStyle}>SKU</th>
                <th style={thStyle}>Order Date</th>
                <th style={thStyle}>Qty</th>
                <th style={thStyle}>Sale Price</th>
                <th style={thStyle}>Fees</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.externalId}>
                  <td style={tdStyle}>{row.sku}</td>
                  <td style={tdStyle}>{ukDate(row.orderDate)}</td>
                  <td style={tdStyle}>{row.qty}</td>
                  <td style={tdStyle}>£{(row.salePriceGrossPence / 100).toFixed(2)}</td>
                  <td style={tdStyle}>£{(row.feesGrossPence / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <button onClick={handleImport} style={{ ...primaryButton, marginTop: '18px' }}>
            Confirm import (every order line in the file, not just the ones shown)
          </button>
        </div>
      )}
    </div>
  )
}
