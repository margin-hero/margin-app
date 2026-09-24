'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { importOrdersForPlatform, NormalizedOrder } from '@/lib/importEngine'

function parseTikTokDate(dateStr: string): string {
  // "2026/08/24" -> "2026-08-24"
  return String(dateStr).trim().replace(/\//g, '-')
}

export default function TikTokImportPage() {
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<NormalizedOrder[]>([])
  const [unmatchedCount, setUnmatchedCount] = useState(0)
  const [skippedRefundCount, setSkippedRefundCount] = useState(0)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setStatus('Reading file and checking against your saved SKU catalog...')

    const reader = new FileReader()
    reader.onload = async (event) => {
      const data = event.target?.result
      const workbook = XLSX.read(data, { type: 'binary' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      // Load the saved SKU ID -> Seller SKU catalog
      const { data: catalogRows, error: catalogError } = await supabase
        .from('tiktok_sku_catalog')
        .select('sku_id, seller_sku')

      if (catalogError) {
        setStatus(`Error loading SKU catalog: ${catalogError.message}`)
        return
      }

      const catalogMap = new Map(catalogRows.map((c) => [c.sku_id, c.seller_sku]))

      let refundsSkipped = 0
      let noMatch = 0
      const normalized: NormalizedOrder[] = []

      for (const row of rows) {
        if (row['Type'] !== 'Order') continue

        const grossSales = parseFloat(row['Gross sales']) || 0
        // Skip pure refund rows (no sale portion this period) — refunds handled in a later pass
        if (grossSales <= 0) {
          refundsSkipped++
          continue
        }

        const rawSkuId = String(row['SKU ID']).trim()
        const sellerSku = catalogMap.get(rawSkuId)
        if (!sellerSku) noMatch++
        const sku = sellerSku || rawSkuId // fall back to raw ID if catalog has no match yet

        const orderId = String(row['Order/adjustment ID']).trim()
        const feesGrossPence = Math.round(Math.abs(parseFloat(row['Fees']) || 0) * 100)
        const vatPence = Math.round(Math.abs(parseFloat(row['VAT']) || 0) * 100)
        const shippingRaw = parseFloat(row['Shipping']) || 0

        normalized.push({
          sku,
          externalId: `${orderId}_${rawSkuId}`,
          orderDate: parseTikTokDate(row['Order created date']),
          qty: parseInt(row['Quantity']) || 1,
          salePriceGrossPence: Math.round(grossSales * 100),
          saleVatPence: vatPence,
          feesGrossPence,
          feesVatPence: 0, // not broken out separately in this export
          actualShippingCostPence: shippingRaw !== 0 ? Math.round(Math.abs(shippingRaw) * 100) : null,
        })
      }

      setSkippedRefundCount(refundsSkipped)
      setUnmatchedCount(noMatch)
      setPreview(normalized.slice(0, 20))
      ;(window as any).__tiktokOrders = normalized
      setStatus(
        `Parsed ${normalized.length} order lines. Skipped ${refundsSkipped} refund-only rows (handled later). ` +
        (noMatch > 0 ? `${noMatch} rows had no catalog match — using raw SKU ID for those, update your catalog and re-import to fix.` : 'All SKUs matched your catalog.')
      )
    }
    reader.readAsBinaryString(file)
  }

  async function handleImport() {
    const orders: NormalizedOrder[] = (window as any).__tiktokOrders || []
    if (orders.length === 0) {
      setStatus('No parsed data to import.')
      return
    }

    const result = await importOrdersForPlatform('TikTok', orders, setStatus)

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
      <h1>TikTok Settlement Report Import</h1>
      <p style={{ color: '#666' }}>First pass: standard sales only (refund rows are skipped for now). Upload your catalog mapping first if you haven't already.</p>
      <input type="file" accept=".xlsx" onChange={handleFile} style={{ marginTop: '1rem' }} />
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
                <th style={{ padding: '6px' }}>VAT</th>
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
                  <td style={{ padding: '6px' }}>£{(row.saleVatPence / 100).toFixed(2)}</td>
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
