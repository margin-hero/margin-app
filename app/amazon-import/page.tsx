'use client'

import { pounds, ukDate } from '@/lib/format'
import { useState } from 'react'
import { readSpreadsheet, toIsoDate } from '@/lib/readSpreadsheet'
import { importOrdersForStore, describeImportResult, NormalizedOrder, NormalizedRefund } from '@/lib/importEngine'
import { Store } from '@/lib/stores'
import { FeeLine, FeeType, addFee, feeTotals, shareVat } from '@/lib/fees'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, statusColor } from '@/lib/theme'

type AmazonRow = {
  'transaction-type': string
  'order-id': string
  'order-item-code': string
  'adjustment-id': string
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
  const [allRefunds, setAllRefunds] = useState<NormalizedRefund[]>([])
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

    // Refunds: several rows per refunded item, grouped by the refund (adjustment-id) and the
    // item (order-item-code, the same code as the original sale's line, which links the two).
    // Amounts are negative for money given back, positive for fees Amazon returns.
    const refundGroups = new Map<string, AmazonRow[]>()
    for (const row of data) {
      if (row['transaction-type'] !== 'Refund' || !row['order-item-code']) continue
      const key = `${row['adjustment-id']}_${row['order-item-code']}`
      if (!refundGroups.has(key)) refundGroups.set(key, [])
      refundGroups.get(key)!.push(row)
    }

    const refunds: NormalizedRefund[] = []
    const refundOrderIds = new Map<NormalizedRefund, string>()
    for (const [refundId, rows] of refundGroups) {
      const first = rows[0]
      let principal = 0
      let tax = 0
      const feeBreakdown: FeeLine[] = []
      for (const row of rows) {
        const amt = parseFloat(row.amount) || 0
        if (row['amount-type'] === 'ItemPrice' && row['amount-description'] === 'Principal') {
          principal -= amt
        } else if (row['amount-type'] === 'ItemPrice' && row['amount-description'] === 'Tax') {
          tax -= amt
        } else if (row['amount-type'] === 'ItemFees') {
          // As a cost: fees given back (positive in the file) reduce it, e.g. Commission;
          // fees charged (negative) add to it, e.g. RefundCommission (Amazon's refund admin fee)
          const description = row['amount-description'] || 'Amazon fee'
          addFee(feeBreakdown, amazonFeeType(description), description, Math.round(-amt * 100))
        }
      }
      const feesGrossPence = feeTotals(feeBreakdown).grossPence
      const feesVatPence = Math.round(feesGrossPence - feesGrossPence / 1.2) // 20%, as for sales
      shareVat(feeBreakdown, feesVatPence)

      const refund: NormalizedRefund = {
        sku: first.sku,
        externalId: refundId,
        originalExternalId: first['order-item-code'],
        refundDate: parseAmazonDate(first['posted-date']),
        qty: parseInt(first['quantity-purchased']) || null, // blank on Amazon refunds
        refundGrossPence: Math.round((principal + tax) * 100),
        refundVatPence: Math.round(tax * 100),
        feesGrossPence,
        feesVatPence,
        feeBreakdown,
        returnShippingCostPence: null,
      }
      refunds.push(refund)
      refundOrderIds.set(refund, first['order-id'])
    }

    // Return labels bought through Amazon only have the order-id, so they're added to that
    // order's refunds in this file (shared by refunded price if there are several).
    const returnLabels = new Map<string, number>() // pence by order-id
    for (const row of data) {
      if (row['transaction-type'] === 'other-transaction' && row['amount-description'] === 'Shipping label purchase for return') {
        const pence = Math.round(Math.abs(parseFloat(row.amount) || 0) * 100)
        returnLabels.set(row['order-id'], (returnLabels.get(row['order-id']) || 0) + pence)
      }
    }
    let unmatchedLabels = 0
    for (const [orderId, labelPence] of returnLabels) {
      const lines = refunds.filter((r) => refundOrderIds.get(r) === orderId)
      if (lines.length === 0) {
        unmatchedLabels++
        continue
      }
      const totalRefund = lines.reduce((sum, r) => sum + r.refundGrossPence, 0)
      let left = labelPence
      lines.forEach((r, i) => {
        const last = i === lines.length - 1
        const share = last ? left : totalRefund > 0 ? Math.round((labelPence * r.refundGrossPence) / totalRefund) : 0
        r.returnShippingCostPence = (r.returnShippingCostPence ?? 0) + share
        left -= share
      })
    }

    // A date that couldn't be read would put the sale on the wrong day, so stop here
    const badDates = normalized.filter((o) => !o.orderDate).length + refunds.filter((r) => !r.refundDate).length
    if (badDates > 0) {
      setAllOrders([])
      setAllRefunds([])
      setPreview([])
      setStatus(`Error: ${badDates} line(s) have a posted-date that couldn't be read. Expected a UK date like 31.08.2026 or 31/08/2026.`)
      return
    }

    setAllOrders(normalized)
    setAllRefunds(refunds)
    setPreview(normalized.slice(0, 20))
    setStatus(
      `Found ${normalized.length} order lines and ${refunds.length} refunds (from ${data.length} rows in the file).` +
      (unmatchedLabels
        ? ` Warning: ${unmatchedLabels} return label(s) are for orders with no refund in this file, so they aren't counted (they're usually in the same file as the refund).`
        : '') +
      ' Review the preview below, then confirm import.'
    )
  }

  async function handleImport() {
    if (allOrders.length === 0 && allRefunds.length === 0) {
      setStatus('Nothing to import yet: please choose a file first.')
      return
    }
    if (!store) {
      setStatus('Please choose which store this file is from first.')
      return
    }

    const result = await importOrdersForStore(store, allOrders, setStatus, { createUnknownSkus, refunds: allRefunds })
    setStatus(describeImportResult(result, store))
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>Amazon Import</h1>
      <p style={pageIntro}>Upload the settlement report. Sales and refunds (with Amazon&apos;s refund fee and any return label) are imported together. SAFE-T reimbursements are skipped for now.</p>
      <div style={cardStyle}>
      <StorePicker platformFilter={(p) => p.name.startsWith('Amazon')} value={store} onChange={setStore} />
      <CreateProductsToggle checked={createUnknownSkus} onChange={setCreateUnknownSkus} />
      <input type="file" accept=".txt,.tsv,.csv,.xlsx,.xls" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '16px', display: 'block' }} />
      {status && <p style={{ color: statusColor(status), fontSize: '14px', fontWeight: 600, margin: '16px 0 0', lineHeight: 1.5 }}>{status}</p>}
      </div>

      {(preview.length > 0 || allRefunds.length > 0) && (
        <div style={cardStyle}>
          <p style={cardTitle}>Preview</p>
          {preview.length > 0 && (
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
          )}
          {allRefunds.length > 0 && (
            <>
              <p style={{ ...cardTitle, margin: preview.length > 0 ? '22px 0 12px' : '0 0 12px' }}>Refunds (first 20)</p>
              <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>SKU</th>
                    <th style={thStyle}>Refund Date</th>
                    <th style={thStyle}>Refunded</th>
                    <th style={thStyle}>Fee change</th>
                    <th style={thStyle}>Return postage</th>
                  </tr>
                </thead>
                <tbody>
                  {allRefunds.slice(0, 20).map((r) => (
                    <tr key={r.externalId}>
                      <td style={tdStyle}>{r.sku}</td>
                      <td style={tdStyle}>{ukDate(r.refundDate)}</td>
                      <td style={tdStyle}>{pounds(r.refundGrossPence)}</td>
                      <td style={tdStyle}>{pounds(r.feesGrossPence)}</td>
                      <td style={tdStyle}>{r.returnShippingCostPence ? pounds(r.returnShippingCostPence) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <p style={{ color: muted, fontSize: '13px', margin: '10px 0 0' }}>
                Fee change is what the refund does to your fees: negative = Amazon gave fees back (after keeping its refund fee).
              </p>
            </>
          )}
          <button onClick={handleImport} style={{ ...primaryButton, marginTop: '18px' }}>
            Confirm import (every order line and refund in the file, not just the ones shown)
          </button>
        </div>
      )}
    </div>
  )
}
