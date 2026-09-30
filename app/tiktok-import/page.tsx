'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { importOrdersForStore, NormalizedOrder } from '@/lib/importEngine'
import { Store } from '@/lib/stores'
import StorePicker from '@/components/StorePicker'

function parseTikTokDate(dateStr: string): string {
  // "2026/08/24" -> "2026-08-24"
  return String(dateStr).trim().replace(/\//g, '-')
}

// Parts of TikTok's "Fees" total that are NOT TikTok's own service fees.
// Affiliate commission goes to creators (mostly not VAT registered), and
// seller-funded promotions are discounts, so neither carries reclaimable VAT.
// Everything else in "Fees" (commission, shipping service fee, Smart Promotion
// fee, etc.) is treated as including 20% UK VAT.
const NO_VAT_FEE_COLUMNS = [
  'Affiliate Commission',
  'Affiliate partner commission',
  'Affiliate Shop Ads commission',
  'Affiliate Partner shop ads commission',
  'Affiliate commission deposit',
  'Affiliate commission refund',
  'Co-funded promotion (seller-funded)',
]

const num = (value: unknown) => parseFloat(String(value)) || 0

export default function TikTokImportPage() {
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<NormalizedOrder[]>([])
  const [unmatchedCount, setUnmatchedCount] = useState(0)
  const [skippedRefundCount, setSkippedRefundCount] = useState(0)
  const [store, setStore] = useState<Store | null>(null)

  // Parsed rows were matched against one store's catalog, so switching store means re-reading the file
  function changeStore(newStore: Store | null) {
    setStore(newStore)
    setPreview([])
    ;(window as any).__tiktokOrders = []
    setStatus('')
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!store) {
      setStatus('Please choose which store this file is from first.')
      return
    }

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
        .eq('store_id', store.id)

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

        // Net sales = Gross sales minus seller-funded discounts minus any refund
        // reported on the same row. Platform-funded discounts are paid by TikTok,
        // so they don't reduce what the seller earns.
        const netSales = num(row['Net sales'])
        // Skip lines that were fully refunded (net £0) and refund-only rows
        // (negative) — refunds against earlier sales are handled in a later pass
        if (netSales <= 0) {
          refundsSkipped++
          continue
        }

        const rawSkuId = String(row['SKU ID']).trim()
        const sellerSku = catalogMap.get(rawSkuId)
        if (!sellerSku) noMatch++
        const sku = sellerSku || rawSkuId // fall back to raw ID if catalog has no match yet

        const orderId = String(row['Order/adjustment ID']).trim()
        const feesGrossPence = Math.round(Math.abs(num(row['Fees'])) * 100)
        const noVatFees = NO_VAT_FEE_COLUMNS.reduce((sum, col) => sum + num(row[col]), 0)
        const vatableFeesPence = Math.round(Math.abs(num(row['Fees']) - noVatFees) * 100)
        // 20% VAT inside a VAT-inclusive amount is 1/6 of it
        const feesVatPence = Math.round(vatableFeesPence / 6)
        // TikTok only fills this when it collects the VAT itself (e.g. overseas
        // sellers). For UK sellers it's 0 and VAT is worked out from the product's rate.
        const vatPence = Math.round(Math.abs(num(row['VAT'])) * 100)
        const shippingRaw = num(row['Shipping'])

        normalized.push({
          sku,
          externalId: `${orderId}_${rawSkuId}`,
          orderDate: parseTikTokDate(row['Order created date']),
          qty: parseInt(row['Quantity']) || 1,
          salePriceGrossPence: Math.round(netSales * 100),
          saleVatPence: vatPence,
          feesGrossPence,
          feesVatPence,
          actualShippingCostPence: shippingRaw !== 0 ? Math.round(Math.abs(shippingRaw) * 100) : null,
        })
      }

      setSkippedRefundCount(refundsSkipped)
      setUnmatchedCount(noMatch)
      setPreview(normalized.slice(0, 20))
      ;(window as any).__tiktokOrders = normalized
      setStatus(
        `Parsed ${normalized.length} order lines. Skipped ${refundsSkipped} fully refunded or refund-only rows (refunds are handled later).` +
        (noMatch > 0 ? `WARNING: ${noMatch} rows had no catalog match. Do NOT confirm yet — upload an up-to-date catalog on the TikTok Catalog page first, then choose this file again. Confirming now would create products named after TikTok's numeric IDs, and fixing it later would double-count those sales.` : 'All SKUs matched your catalog.')
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
    if (!store) {
      setStatus('Please choose which store this file is from first.')
      return
    }

    const result = await importOrdersForStore(store, orders, setStatus)

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
      <p style={{ color: '#666' }}>First pass: standard sales only (refund rows are skipped for now). Upload your catalog mapping first, and don't confirm an import if any SKUs are unmatched.</p>
      <StorePicker platformFilter={(p) => p.name === 'TikTok'} value={store} onChange={changeStore} />
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
