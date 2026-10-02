'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { importOrdersForStore, describeImportResult, NormalizedOrder } from '@/lib/importEngine'
import { Store } from '@/lib/stores'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, statusColor } from '@/lib/theme'

function parseMiraklDate(dateStr: string): string {
  // "09/07/2026 - 21:45:52" -> "2026-07-09"
  const datePart = String(dateStr).split(' - ')[0]
  const [day, month, year] = datePart.split('/')
  return `${year}-${month}-${day}`
}

export default function MiraklImportPage() {
  const [store, setStore] = useState<Store | null>(null)
  const [createUnknownSkus, setCreateUnknownSkus] = useState(false)
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<NormalizedOrder[]>([])
  const [allOrders, setAllOrders] = useState<NormalizedOrder[]>([])
  const [skippedRefunds, setSkippedRefunds] = useState(0)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!store) {
      setStatus('Please select which store this export is from first.')
      return
    }

    setStatus('Reading file...')

    const reader = new FileReader()
    reader.onload = (event) => {
      const data = event.target?.result
      const workbook = XLSX.read(data, { type: 'binary' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      // Only sale-related transaction types — skip refund rows for this first pass
      const saleTypes = ['Order amount', 'Order amount tax', 'Shipping charges', 'Shipping tax', 'Commission', 'Commission tax']
      const saleRows = rows.filter((row) => saleTypes.includes(row['Type']))
      const refundRows = rows.filter((row) => String(row['Type']).toLowerCase().includes('refund'))

      const groups = new Map<string, any[]>()
      for (const row of saleRows) {
        const key = row['Order line ID']
        if (!key) continue
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(row)
      }

      const normalized: NormalizedOrder[] = []
      for (const [orderLineId, groupRows] of groups) {
        const first = groupRows[0]
        const sumByType = (type: string) =>
          groupRows.filter((r) => r['Type'] === type).reduce((sum, r) => sum + (parseFloat(r['Amount']) || 0), 0)

        const orderAmount = sumByType('Order amount')
        const orderAmountTax = sumByType('Order amount tax')
        const shippingCharge = sumByType('Shipping charges')
        const shippingTax = sumByType('Shipping tax')
        const commission = sumByType('Commission')
        const commissionTax = sumByType('Commission tax')

        normalized.push({
          sku: String(first['Offer SKU']).trim(),
          externalId: String(orderLineId).trim(),
          orderDate: parseMiraklDate(first['Transaction Date'] || first['Date created']),
          qty: parseInt(first['Quantity']) || 1,
          salePriceGrossPence: Math.round((orderAmount + orderAmountTax) * 100),
          saleVatPence: Math.round(orderAmountTax * 100),
          feesGrossPence: Math.round(Math.abs(commission + commissionTax) * 100),
          feesVatPence: Math.round(Math.abs(commissionTax) * 100),
          actualShippingCostPence: null, // Mirakl doesn't report real courier cost — uses your shipping_rules instead
          shippingRevenueGrossPence: Math.round((shippingCharge + shippingTax) * 100),
          shippingRevenueVatPence: Math.round(shippingTax * 100),
        })
      }

      setAllOrders(normalized)
      setPreview(normalized.slice(0, 20))
      setSkippedRefunds(refundRows.length)
      setStatus(`Found ${normalized.length} order lines. Skipped ${refundRows.length} refund-related rows (handled later). Review below, then confirm.`)
    }
    reader.readAsBinaryString(file)
  }

  async function handleImport() {
    if (allOrders.length === 0) {
      setStatus('Nothing to import yet: please choose a file first.')
      return
    }
    if (!store) {
      setStatus('Please select which store this export is from first.')
      return
    }
    const result = await importOrdersForStore(store, allOrders, setStatus, { createUnknownSkus })
    setStatus(describeImportResult(result, store))
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>Mirakl Import</h1>
      <p style={pageIntro}>Used for B&Q, The Range, Debenhams, and Tesco — same underlying report format, different retailer.</p>

      <div style={cardStyle}>

      <StorePicker platformFilter={(p) => p.integration_type === 'mirakl'} value={store} onChange={setStore} />
      <CreateProductsToggle checked={createUnknownSkus} onChange={setCreateUnknownSkus} />

      <input type="file" accept=".xlsx,.csv" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '16px', display: 'block' }} />
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
                <th style={thStyle}>Shipping Revenue</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.externalId}>
                  <td style={tdStyle}>{row.sku}</td>
                  <td style={tdStyle}>{row.orderDate}</td>
                  <td style={tdStyle}>{row.qty}</td>
                  <td style={tdStyle}>£{(row.salePriceGrossPence / 100).toFixed(2)}</td>
                  <td style={tdStyle}>£{(row.feesGrossPence / 100).toFixed(2)}</td>
                  <td style={tdStyle}>£{((row.shippingRevenueGrossPence || 0) / 100).toFixed(2)}</td>
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
