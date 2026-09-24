'use client'

import { useState } from 'react'
import Papa from 'papaparse'
import { importOrdersForPlatform, NormalizedOrder } from '@/lib/importEngine'

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

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setStatus('Parsing file, this may take a moment for large files...')

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
        setStatus(`Parsed ${normalized.length} order lines from ${orderRows.length} raw rows. Showing first 20 below — review, then confirm import.`)
      },
    })
  }

  async function handleImport() {
    if (allOrders.length === 0) {
      setStatus('No parsed data to import.')
      return
    }

    const result = await importOrdersForPlatform('Amazon UK', allOrders, setStatus)

    if (result.errors.length > 0) {
      setStatus(`Errors: ${result.errors.slice(0, 3).join(' | ')}${result.errors.length > 3 ? '...' : ''}`)
      return
    }

    setStatus(
      `Done. Imported ${result.imported} new order lines. Skipped ${result.skippedDuplicates} already-imported. ` +
      `${result.skippedNoSku.length} rows had no matching SKU after product creation attempt.`
    )
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Amazon Settlement Report Import</h1>
      <p style={{ color: '#666' }}>First pass: standard sales only (Refunds and SAFE-T reimbursements are skipped for now).</p>
      <input type="file" accept=".csv" onChange={handleFile} style={{ marginTop: '1rem' }} />
      <p>{status}</p>

      {preview.length > 0 && (
        <>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '1rem', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                <th style={{ padding: '6px' }}>SKU</th>
                <th style={{ padding: '6px' }}>Order Date</th>
                <th style={{ padding: '6px' }}>Qty</th>
                <th style={{ padding: '6px' }}>Sale Price</th>
                <th style={{ padding: '6px' }}>Fees</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.externalId} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px' }}>{row.sku}</td>
                  <td style={{ padding: '6px' }}>{row.orderDate}</td>
                  <td style={{ padding: '6px' }}>{row.qty}</td>
                  <td style={{ padding: '6px' }}>£{(row.salePriceGrossPence / 100).toFixed(2)}</td>
                  <td style={{ padding: '6px' }}>£{(row.feesGrossPence / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={handleImport} style={{ marginTop: '1rem', padding: '8px 16px' }}>
            Confirm Import (all parsed rows, not just preview)
          </button>
        </>
      )}
    </div>
  )
}
