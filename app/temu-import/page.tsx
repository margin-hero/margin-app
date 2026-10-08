'use client'

import { useState } from 'react'
import { importOrdersForStore, importResultSummary, NormalizedOrder } from '@/lib/importEngine'
import ConfirmImport from '@/components/ConfirmImport'
import { readSpreadsheet, toIsoDate } from '@/lib/readSpreadsheet'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { Store } from '@/lib/stores'
import { FeeLine, addFee } from '@/lib/fees'
import { pounds, ukDate } from '@/lib/format'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, statusColor } from '@/lib/theme'

const toPence = (value: string | undefined) => Math.round((parseFloat(value || '') || 0) * 100)

// Columns Margin Hero doesn't use yet. A row with any of them filled in is flagged in the
// status (its figures may not add up to Temu's Total) so the case can be checked and added.
const NOT_HANDLED_YET = ['Platform discount', 'Platform incentive', 'Platform incentive - Shipping', 'Platform incentive Tax', 'Others']

type Parsed = NormalizedOrder & { orderId: string; skuId: string; title: string; totalPence: number }

export default function TemuImportPage() {
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
      rows = await readSpreadsheet(file, ['Date/time'])
    } catch (err) {
      setStatus(`Error: could not read the file (${err instanceof Error ? err.message : err}).`)
      return
    }
    if (rows.length > 0 && !('Transaction type' in rows[0] && 'SKU ID' in rows[0] && 'Retail price' in rows[0])) {
      setStatus('Error: this doesn\'t look like a Temu transaction export (no "Transaction type" / "SKU ID" / "Retail price" columns).')
      return
    }

    // Temu SKU ID -> your SKU, from each listing's Temu SKU ID in this store (like TikTok)
    const { data: skuIdRows, error: skuIdError } = await fetchAll((from, to) =>
      supabase.from('channel_sku_ids').select('sku_id, seller_sku').eq('store_id', store.id).order('sku_id').range(from, to)
    )
    if (skuIdError) {
      setStatus(`Error loading Temu SKU IDs: ${skuIdError.message}`)
      return
    }
    const sellerSkuOf = new Map(skuIdRows.map((c) => [String(c.sku_id), c.seller_sku as string]))
    const unmatchedIds = new Set<string>()

    const parsed: Parsed[] = []
    const otherTypes = new Map<string, number>() // refunds etc., handled later
    const unhandled = new Set<string>()
    let badRows = 0
    let mismatched = 0
    for (const row of rows) {
      const type = (row['Transaction type'] || '').trim()
      if (type !== 'Order Payment') {
        if (type) otherTypes.set(type, (otherTypes.get(type) || 0) + 1)
        continue
      }
      // Temu's "SKU" column is the product title; "SKU ID" is Temu's number for the variant,
      // translated to your SKU. Unknown IDs fall back to the raw number (so they're held back).
      const skuId = (row['SKU ID'] || '').trim()
      const sellerSku = sellerSkuOf.get(skuId)
      if (skuId && !sellerSku) unmatchedIds.add(skuId)
      const sku = sellerSku || skuId
      const orderItemId = (row['Order item ID'] || '').trim()
      const orderDate = toIsoDate(row['Date/time'] || '')
      // "Retail price" is before VAT; "Product Tax" is the VAT on it. A seller-funded discount
      // comes off what you're paid; a platform discount is paid by Temu.
      const itemsNetPence = toPence(row['Retail price']) - Math.abs(toPence(row['Seller discount']))
      const productTaxPence = toPence(row['Product Tax'])
      if (!sku || !orderItemId || !orderDate || itemsNetPence <= 0) {
        badRows++
        continue
      }
      NOT_HANDLED_YET.forEach((col) => { if (toPence(row[col]) !== 0) unhandled.add(col) })

      const shippingPence = toPence(row['Shipping'])
      const shippingTaxPence = toPence(row['Shipping Tax'])
      // "Service fee (tax incl.)" is negative and includes 20% VAT (1/6 of it)
      const feeGrossPence = Math.abs(toPence(row['Service fee (tax incl.)']))
      const feeVatPence = Math.round(feeGrossPence / 6)
      const feeBreakdown: FeeLine[] = []
      addFee(feeBreakdown, 'commission', 'Service fee', feeGrossPence, feeVatPence)

      const salePriceGrossPence = itemsNetPence + productTaxPence
      const shippingGrossPence = shippingPence + shippingTaxPence
      // Check our reading of the row against Temu's own Total (what you're paid)
      const totalPence = toPence(row['Total'])
      if (Math.abs(salePriceGrossPence + shippingGrossPence - feeGrossPence - totalPence) > 1) mismatched++

      parsed.push({
        sku,
        externalId: orderItemId,
        orderId: (row['Order ID'] || '').trim(),
        skuId,
        title: (row['SKU'] || '').trim(),
        orderDate,
        qty: parseInt(row['Quantity']) || 1,
        salePriceGrossPence,
        saleVatPence: productTaxPence,
        feesGrossPence: feeGrossPence,
        feesVatPence: feeVatPence,
        feeBreakdown,
        actualShippingCostPence: null, // Temu doesn't report your courier cost: shipping rules / profiles are used
        shippingRevenueGrossPence: shippingGrossPence,
        shippingRevenueVatPence: shippingTaxPence,
        totalPence,
      })
    }

    setAllOrders(parsed)
    setStatus(
      `Found ${parsed.length} order lines.` +
      (otherTypes.size ? ` Skipped rows that aren't sales (handled later): ${Array.from(otherTypes, ([t, n]) => `${n} ${t}`).join(', ')}.` : '') +
      (unmatchedIds.size
        ? ` Warning: ${unmatchedIds.size} Temu SKU ID(s) aren't on any product yet: ${Array.from(unmatchedIds).slice(0, 10).join(', ')}${unmatchedIds.size > 10 ? ' and more' : ''}. Add each one to its product's store SKU for this Temu store (on the product's page), then choose this file again. If you confirm now, those sales are held back (don't tick "Create new products" here, or you'll get products named after Temu's numbers).`
        : '') +
      (badRows ? ` Warning: skipped ${badRows} sale row(s) with no SKU ID, order item ID, date or price.` : '') +
      (unhandled.size ? ` Warning: some rows use columns Margin Hero doesn't handle yet (${Array.from(unhandled).join(', ')}), so please check them and send an example.` : '') +
      (mismatched ? ` Warning: ${mismatched} row(s) don't add up to Temu's Total, please check them.` : '') +
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
      <h1 style={pageTitle}>Temu Import</h1>
      <p style={pageIntro}>
        Upload the Temu transaction export (CSV or Excel). Temu&apos;s report shows its own <strong>SKU ID</strong> (a long number) instead of
        your SKU, so each product&apos;s store SKU for your Temu store needs its Temu SKU ID too (on the product&apos;s page, Store SKUs).
        Sales only for now: refunds come later.
      </p>

      <div style={cardStyle}>
        <StorePicker platformFilter={(p) => p.integration_type === 'temu'} value={store} onChange={setStore} />
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
                  <th style={thStyle}>Temu SKU ID</th>
                  <th style={thStyle}>Product</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Sale (inc. VAT)</th>
                  <th style={thStyle}>Shipping</th>
                  <th style={thStyle}>Fees (inc. VAT)</th>
                  <th style={thStyle}>Temu total</th>
                </tr>
              </thead>
              <tbody>
                {allOrders.slice(0, 20).map((row) => (
                  <tr key={row.externalId}>
                    <td style={tdStyle}>{row.orderId}</td>
                    <td style={tdStyle}>{row.sku === row.skuId ? '—' : row.sku}</td>
                    <td style={tdStyle}>{row.skuId}</td>
                    <td style={{ ...tdStyle, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.title}>{row.title}</td>
                    <td style={tdStyle}>{ukDate(row.orderDate)}</td>
                    <td style={tdStyle}>{row.qty}</td>
                    <td style={tdStyle}>{pounds(row.salePriceGrossPence)}</td>
                    <td style={tdStyle}>{pounds(row.shippingRevenueGrossPence ?? 0)}</td>
                    <td style={tdStyle}>{pounds(row.feesGrossPence)}</td>
                    <td style={tdStyle}>{pounds(row.totalPence)}</td>
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
