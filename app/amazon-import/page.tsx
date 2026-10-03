'use client'

import { ukDate } from '@/lib/format'
import { useState } from 'react'
import Papa from 'papaparse'
import { importOrdersForStore, describeImportResult, NormalizedOrder } from '@/lib/importEngine'
import { Store } from '@/lib/stores'
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

function parseAmazonDate(dateStr: string): string {
  const datePart = dateStr.split(' ')[0]
  const [day, month, year] = datePart.split('.')
  return `${year}-${month}-${day}`
}

export default function AmazonImportPage() {
  const [status, setStatus] = useState<string>('')
  const [preview, setPreview] = useState<NormalizedOrder[]>([])
  const [allOrders, setAllOrders] = useState<NormalizedOrder[]>([])
  const [store, setStore] = useState<Store | null>(null)
  const [createUnknownSkus, setCreateUnknownSkus] = useState(false)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setStatus('Reading file, this may take a moment for large files...')

    Papa.parse<AmazonRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const orderRows = results.data.filter((row) => row['transaction-type'] === 'Order')

        const groups = new Map<string, AmazonRow[]>()
        for (const row of orderRows) {
          const key = row['order-item-code']
          if (!key) continue
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(row)
        }

        const shippingByOrderId = new Map<string, number>()
        for (const row of results.data) {
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
          let fees = 0

          for (const row of rows) {
            const amt = parseFloat(row.amount)
            if (row['amount-type'] === 'ItemPrice' && row['amount-description'] === 'Principal') {
              principal += amt
            } else if (row['amount-type'] === 'ItemPrice' && row['amount-description'] === 'Tax') {
              tax += amt
            } else if (row['amount-type'] === 'ItemFees') {
              fees += Math.abs(amt)
            }
          }

          const feesGrossPence = Math.round(fees * 100)
          const feesVatPence = Math.round(feesGrossPence - feesGrossPence / 1.2)
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
            actualShippingCostPence: shippingByOrderId.has(orderId)
              ? Math.round(shippingByOrderId.get(orderId)! * 100)
              : null,
          })
        }

        setAllOrders(normalized)
        setPreview(normalized.slice(0, 20))
        setStatus(`Found ${normalized.length} order lines (from ${orderRows.length} rows in the file). Showing first 20 below — review, then confirm import.`)
      },
    })
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
      <input type="file" accept=".csv" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '16px', display: 'block' }} />
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
