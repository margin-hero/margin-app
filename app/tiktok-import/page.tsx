'use client'

import { ukDate } from '@/lib/format'
import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { importOrdersForStore, describeImportResult, NormalizedOrder } from '@/lib/importEngine'
import { Store } from '@/lib/stores'
import { FeeLine, addFee } from '@/lib/fees'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, statusColor } from '@/lib/theme'

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
  const [createUnknownSkus, setCreateUnknownSkus] = useState(false)

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
      const { data: catalogRows, error: catalogError } = await fetchAll((from, to) =>
        supabase
          .from('tiktok_sku_catalog')
          .select('sku_id, seller_sku')
          .eq('store_id', store.id)
          .order('sku_id')
          .range(from, to)
      )

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
        // Split out the no-VAT parts (fees are negative in the file, so flip the sign to get a cost).
        // The rest of "Fees" (TikTok's own fees, with all the VAT) is saved as "Not broken down" for now.
        const feeSign = num(row['Fees']) < 0 ? -1 : 1
        const feeBreakdown: FeeLine[] = []
        for (const col of NO_VAT_FEE_COLUMNS) {
          const type = col.startsWith('Co-funded promotion') ? 'advertising' : 'affiliate'
          addFee(feeBreakdown, type, col, Math.round(num(row[col]) * feeSign * 100))
        }
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
          saleVatPence: vatPence || null, // 0 (UK sellers) = work it out from the product's VAT rate
          feesGrossPence,
          feesVatPence,
          feeBreakdown,
          actualShippingCostPence: shippingRaw !== 0 ? Math.round(Math.abs(shippingRaw) * 100) : null,
        })
      }

      setSkippedRefundCount(refundsSkipped)
      setUnmatchedCount(noMatch)
      setPreview(normalized.slice(0, 20))
      ;(window as any).__tiktokOrders = normalized
      setStatus(
        `Found ${normalized.length} order lines. Skipped ${refundsSkipped} fully refunded or refund-only rows (refunds are handled later).` +
        (noMatch > 0 ? `WARNING: ${noMatch} rows had no catalog match. Best fix: add their TikTok SKU IDs on the Mappings page (one by one, or with the TikTok catalog upload there), then choose this file again. If you confirm now anyway, those rows are held back (don't tick "Create new products" here, or you'll get products named after TikTok's numeric IDs).` : 'All SKUs matched your catalog.')
      )
    }
    reader.readAsBinaryString(file)
  }

  async function handleImport() {
    const orders: NormalizedOrder[] = (window as any).__tiktokOrders || []
    if (orders.length === 0) {
      setStatus('Nothing to import yet: please choose a file first.')
      return
    }
    if (!store) {
      setStatus('Please choose which store this file is from first.')
      return
    }

    const result = await importOrdersForStore(store, orders, setStatus, { createUnknownSkus })
    setStatus(describeImportResult(result, store))
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>TikTok Import</h1>
      <p style={pageIntro}>First pass: standard sales only (refund rows are skipped for now). Set up each product's TikTok SKU ID on the Mappings page first (or upload the shop's catalog there). Rows whose SKU isn't matched are held back and listed, so you can fix them and upload the same file again.</p>
      <div style={cardStyle}>
      <StorePicker platformFilter={(p) => p.name === 'TikTok'} value={store} onChange={changeStore} />
      <CreateProductsToggle checked={createUnknownSkus} onChange={setCreateUnknownSkus} />
      <input type="file" accept=".xlsx" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '16px', display: 'block' }} />
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
                <th style={thStyle}>VAT</th>
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
                  <td style={tdStyle}>{row.saleVatPence === null ? 'From product rate' : `£${(row.saleVatPence / 100).toFixed(2)}`}</td>
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
