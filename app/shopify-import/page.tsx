'use client'

import { useState } from 'react'
import { importOrdersForStore, importResultSummary, NormalizedOrder } from '@/lib/importEngine'
import ConfirmImport from '@/components/ConfirmImport'
import { readSpreadsheet, toIsoDate } from '@/lib/readSpreadsheet'
import { Store } from '@/lib/stores'
import { pounds, ukDate } from '@/lib/format'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, statusColor } from '@/lib/theme'

type Row = Record<string, string>
type Parsed = NormalizedOrder & { shopifyTotalPence: number; orderTotalOk: boolean }

const toPence = (value: string | undefined) => Math.round((parseFloat(value || '') || 0) * 100)

// Only these orders are sales to import. Refunded / voided / unpaid ones are skipped
// (refunds are handled later; partially refunded orders count as the original sale for now).
const IMPORTED_STATUSES = ['paid', 'partially_refunded']

// Split `total` pence across lines in proportion to `weights`; the last line takes the
// leftover penny so the parts always add up exactly.
function share(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  let given = 0
  return weights.map((w, i) => {
    if (i === weights.length - 1) return total - given
    const part = sum > 0 ? Math.round((total * w) / sum) : 0
    given += part
    return part
  })
}

// Shopify Payments fees per order number, from the payment transactions export.
// Only "charge" rows count (refund rows are skipped for now). Fee = the gross fee;
// "VAT" is its VAT (0 for UK Shopify Payments, as card fees are VAT exempt).
function feesByOrder(txRows: Row[]): Map<string, { fee: number; vat: number }> {
  const fees = new Map<string, { fee: number; vat: number }>()
  for (const row of txRows) {
    if ((row['Type'] || '').toLowerCase() !== 'charge') continue
    const order = (row['Order'] || '').trim()
    if (!order) continue
    const current = fees.get(order) || { fee: 0, vat: 0 }
    current.fee += Math.abs(toPence(row['Fee']))
    current.vat += Math.abs(toPence(row['VAT']))
    fees.set(order, current)
  }
  return fees
}

// Shopify's orders export: one row per product, but order-level columns (status, dates,
// shipping, discount, total) are only filled on each order's first row.
function parseOrders(orderRows: Row[], txRows: Row[] | null) {
  const fees = txRows ? feesByOrder(txRows) : null
  const orders = new Map<string, Row[]>()
  for (const row of orderRows) {
    const name = (row['Name'] || '').trim()
    if (!name) continue
    if (!orders.has(name)) orders.set(name, [])
    orders.get(name)!.push(row)
  }

  const parsed: Parsed[] = []
  let skippedOrders = 0
  let noSkuLines = 0
  let noFeeOrders = 0
  let paypalOrders = 0
  let mismatchedOrders = 0

  for (const [name, rows] of orders) {
    const first = rows[0]
    const status = (first['Financial Status'] || '').trim().toLowerCase()
    const orderDate = toIsoDate(first['Created at'] || '')
    if (first['Cancelled at'] || !IMPORTED_STATUSES.includes(status) || !orderDate) {
      skippedOrders++
      continue
    }

    // Each product's price after its own discount; the same SKU twice in one order is combined
    const lines = new Map<string, { qty: number; grossPence: number; lineDiscountPence: number }>()
    for (const row of rows) {
      const sku = (row['Lineitem sku'] || '').trim()
      if (!sku) {
        noSkuLines++ // e.g. custom items or tips with no SKU
        continue
      }
      const qty = parseInt(row['Lineitem quantity']) || 1
      const lineDiscountPence = Math.abs(toPence(row['Lineitem discount']))
      const line = lines.get(sku) || { qty: 0, grossPence: 0, lineDiscountPence: 0 }
      line.qty += qty
      line.grossPence += toPence(row['Lineitem price']) * qty - lineDiscountPence
      line.lineDiscountPence += lineDiscountPence
      lines.set(sku, line)
    }
    if (lines.size === 0) continue

    const skus = [...lines.keys()]
    const grossBefore = skus.map((s) => lines.get(s)!.grossPence)

    // Any order discount not already taken off a product (e.g. a whole-order code) is shared by price
    const lineDiscounts = skus.reduce((sum, s) => sum + lines.get(s)!.lineDiscountPence, 0)
    const extraDiscount = Math.max(0, Math.abs(toPence(first['Discount Amount'])) - lineDiscounts)
    const discountShares = share(extraDiscount, grossBefore)
    const gross = grossBefore.map((g, i) => g - discountShares[i])

    const shippingShares = share(toPence(first['Shipping']), gross)

    // PayPal fees aren't in either Shopify file, so PayPal orders count as £0 fees for now
    const isPayPal = (first['Payment Method'] || '').toLowerCase().includes('paypal')
    if (isPayPal) paypalOrders++
    const orderFee = fees?.get(name)
    if (fees && !orderFee && !isPayPal) noFeeOrders++
    const feeShares = share(orderFee?.fee ?? 0, gross)
    const feeVatShares = share(orderFee?.vat ?? 0, gross)

    // Check against Shopify's own order total (UK shops: prices include VAT)
    const shopifyTotalPence = toPence(first['Total'])
    const ourTotal = gross.reduce((a, b) => a + b, 0) + toPence(first['Shipping'])
    const orderTotalOk = Math.abs(ourTotal - shopifyTotalPence) <= 1
    if (!orderTotalOk) mismatchedOrders++

    skus.forEach((sku, i) => {
      parsed.push({
        sku,
        externalId: name,
        orderDate,
        qty: lines.get(sku)!.qty,
        salePriceGrossPence: gross[i],
        saleVatPence: null, // worked out from the product's VAT rate (copes with mixed-rate orders)
        feesGrossPence: feeShares[i],
        feesVatPence: feeVatShares[i],
        feeBreakdown: [{ type: 'payment', label: 'Shopify Payments', grossPence: feeShares[i], vatPence: feeVatShares[i] }],
        actualShippingCostPence: null, // Shopify doesn't report your courier cost: shipping rules / profiles are used
        shippingRevenueGrossPence: shippingShares[i],
        shippingRevenueVatPence: null,
        shopifyTotalPence,
        orderTotalOk,
      })
    })
  }

  return { parsed, skippedOrders, noSkuLines, noFeeOrders, paypalOrders, mismatchedOrders }
}

export default function ShopifyImportPage() {
  const [store, setStore] = useState<Store | null>(null)
  const [createUnknownSkus, setCreateUnknownSkus] = useState(false)
  const [orderRows, setOrderRows] = useState<Row[] | null>(null)
  const [txRows, setTxRows] = useState<Row[] | null>(null)
  const [fileError, setFileError] = useState('')
  const [importStatus, setImportStatus] = useState('')

  async function readFile(e: React.ChangeEvent<HTMLInputElement>, kind: 'orders' | 'payments') {
    const file = e.target.files?.[0]
    if (!file) return
    setImportStatus('')
    let rows: Row[]
    try {
      rows = await readSpreadsheet(file)
    } catch (err) {
      setFileError(`Error: could not read the file (${err instanceof Error ? err.message : err}).`)
      return
    }
    const needed = kind === 'orders' ? ['Name', 'Lineitem sku', 'Financial Status'] : ['Order', 'Type', 'Fee']
    if (rows.length > 0 && !needed.every((col) => col in rows[0])) {
      setFileError(
        kind === 'orders'
          ? 'Error: this doesn\'t look like a Shopify orders export (no "Name" / "Lineitem sku" / "Financial Status" columns).'
          : 'Error: this doesn\'t look like a Shopify payment transactions export (no "Order" / "Type" / "Fee" columns).'
      )
      return
    }
    setFileError('')
    if (kind === 'orders') setOrderRows(rows)
    else setTxRows(rows)
  }

  const result = orderRows ? parseOrders(orderRows, txRows) : null

  let status = fileError || importStatus
  if (!status && result) {
    status =
      `Found ${result.parsed.length} order lines.` +
      (result.skippedOrders ? ` Skipped ${result.skippedOrders} order(s) that are cancelled, refunded or unpaid.` : '') +
      (result.noSkuLines ? ` Skipped ${result.noSkuLines} line(s) with no SKU.` : '') +
      (!txRows ? ' Warning: no payments file yet, so Shopify Payments fees count as £0.' : '') +
      (result.paypalOrders ? ` Note: ${result.paypalOrders} order(s) were paid by PayPal; PayPal fees aren't in Shopify's files, so they count as £0 for now.` : '') +
      (result.noFeeOrders ? ` Warning: ${result.noFeeOrders} order(s) have no fee in the payments file, so their fees count as £0.` : '') +
      (result.mismatchedOrders ? ` Warning: ${result.mismatchedOrders} order(s) don't add up to Shopify's order Total, please check them.` : '') +
      ' Review below, then confirm.'
  }

  async function handleImport(progress: (message: string) => void) {
    if (!result || result.parsed.length === 0) {
      return 'Nothing to import yet: please choose the orders file first.'
    }
    if (!store) {
      return 'Please select which store this export is from first.'
    }
    const outcome = await importOrdersForStore(store, result.parsed, progress, { createUnknownSkus })
    return [importResultSummary(outcome, store)]
  }

  const fileInput = { color: muted, fontSize: '14px', marginTop: '8px', display: 'block' }
  const fileLabel = { display: 'block', fontSize: '13px', color: muted, marginTop: '16px' }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>Shopify Import</h1>
      <p style={pageIntro}>
        Upload the Shopify orders export (Orders → Export, CSV) and, if you use Shopify Payments, the payment transactions export
        (Finances → Payouts → Export transactions) for the fees. Shipping and order discounts are shared across each order&apos;s products by price.
      </p>

      <div style={cardStyle}>
        <StorePicker platformFilter={(p) => p.integration_type === 'shopify'} value={store} onChange={setStore} />
        <CreateProductsToggle checked={createUnknownSkus} onChange={setCreateUnknownSkus} />

        <label style={fileLabel}>
          1. Orders export (required)
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => readFile(e, 'orders')} style={fileInput} />
        </label>
        <label style={fileLabel}>
          2. Payment transactions export (optional, for Shopify Payments fees)
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => readFile(e, 'payments')} style={fileInput} />
        </label>
        {status && <p style={{ color: statusColor(status), fontSize: '14px', fontWeight: 600, margin: '16px 0 0', lineHeight: 1.5 }}>{status}</p>}
      </div>

      {result && result.parsed.length > 0 && (
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
                  <th style={thStyle}>Sale price</th>
                  <th style={thStyle}>Shipping charged</th>
                  <th style={thStyle}>Fees</th>
                  <th style={thStyle}>Shopify order total</th>
                </tr>
              </thead>
              <tbody>
                {result.parsed.slice(0, 20).map((row) => (
                  <tr key={row.externalId + row.sku}>
                    <td style={tdStyle}>{row.externalId}</td>
                    <td style={tdStyle}>{row.sku}</td>
                    <td style={tdStyle}>{ukDate(row.orderDate)}</td>
                    <td style={tdStyle}>{row.qty}</td>
                    <td style={tdStyle}>{pounds(row.salePriceGrossPence)}</td>
                    <td style={tdStyle}>{pounds(row.shippingRevenueGrossPence ?? 0)}</td>
                    <td style={tdStyle}>{pounds(row.feesGrossPence)}</td>
                    <td style={tdStyle}>
                      {pounds(row.shopifyTotalPence)}
                      {row.orderTotalOk ? ' ✓' : ' ✗ doesn\'t add up'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ConfirmImport run={handleImport} resetOn={result} />
        </div>
      )}
    </div>
  )
}
