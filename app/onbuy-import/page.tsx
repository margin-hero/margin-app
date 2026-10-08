'use client'

import { useState } from 'react'
import { importOrdersForStore, importResultSummary, NormalizedOrder } from '@/lib/importEngine'
import ConfirmImport from '@/components/ConfirmImport'
import { readSpreadsheet } from '@/lib/readSpreadsheet'
import { Store } from '@/lib/stores'
import { FeeLine, addFee } from '@/lib/fees'
import { pounds, ukDate } from '@/lib/format'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, statusColor } from '@/lib/theme'

// "2026-09-28" (Excel date cell, already converted), "2026-09-28 17:20:00" or "28/09/2026 17:20" -> "2026-09-28"
function parseOnBuyDate(value: string): string | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const uk = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (uk) return `${uk[3]}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`
  return null
}

const toPence = (value: string) => Math.round((parseFloat(value) || 0) * 100)

type Parsed = NormalizedOrder & { netProceedsPence: number }

export default function OnBuyImportPage() {
  const [store, setStore] = useState<Store | null>(null)
  const [createUnknownSkus, setCreateUnknownSkus] = useState(false)
  const [status, setStatus] = useState('')
  const [allOrders, setAllOrders] = useState<Parsed[]>([])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!store) {
      setStatus('Please select which store this export is from first.')
      return
    }

    setStatus('Reading file...')
    let rows: Record<string, string>[]
    try {
      rows = await readSpreadsheet(file, ['Date Paid'])
    } catch (err) {
      setStatus(`Error: could not read the file (${err instanceof Error ? err.message : err}).`)
      return
    }
    if (rows.length > 0 && !('Order Number' in rows[0] && 'Total Fees Inc. TAX £' in rows[0])) {
      setStatus('Error: this doesn\'t look like an OnBuy transaction report (no "Order Number" / "Total Fees Inc. TAX £" columns).')
      return
    }

    // One row per order line. Rows that aren't a sale (refunds, adjustments: no SKU or
    // no positive item price) are skipped for now.
    const parsed: Parsed[] = []
    let skipped = 0
    let mismatched = 0
    for (const row of rows) {
      const sku = (row['SKU'] || '').trim()
      const orderNumber = (row['Order Number'] || '').trim()
      const itemsPence = toPence(row['Items £'])
      const orderDate = parseOnBuyDate(row['Date Paid'] || '')
      if (!sku || !orderNumber || itemsPence <= 0 || !orderDate) {
        skipped++
        continue
      }
      const deliveryPence = toPence(row['Delivery £'])
      const feesPence = Math.abs(toPence(row['Total Fees Inc. TAX £']))
      const feesVatPence = Math.abs(toPence(row['Fees TAX']))
      const netProceedsPence = toPence(row['Net Proceeds'])
      // Check our reading of the row against OnBuy's own payout figure
      if (Math.abs(itemsPence + deliveryPence - feesPence - netProceedsPence) > 1) mismatched++

      // Boost (OnBuy advertising) is inside the fees: "Total Boost Fee" is the line's net Boost
      // cost, plus "Boost Fee TAX Per Item £" for each unit. The rest is OnBuy's sales fee.
      // If the Boost figures don't fit inside the fees, nothing is split (all counted as sales fee).
      const qty = parseInt(row['Quantity']) || 1
      const boostVatPence = Math.abs(toPence(row['Boost Fee TAX Per Item £'])) * qty
      const boostGrossPence = Math.abs(toPence(row['Total Boost Fee'])) + boostVatPence
      const splitBoost = boostGrossPence > 0 && boostGrossPence <= feesPence && boostVatPence <= feesVatPence
      const feeBreakdown: FeeLine[] = []
      if (splitBoost) addFee(feeBreakdown, 'advertising', 'Boost', boostGrossPence, boostVatPence)
      addFee(feeBreakdown, 'commission', 'Sales fee',
        feesPence - (splitBoost ? boostGrossPence : 0), feesVatPence - (splitBoost ? boostVatPence : 0))

      // "Deemed Supplier TAX" is only filled when OnBuy collects the VAT itself (mostly
      // overseas sellers). Otherwise the VAT is worked out from the product's VAT rate.
      const deemedItemTax = row['Deemed Supplier Item TAX']
      const deemedDeliveryTax = row['Deemed Supplier Delivery TAX']

      parsed.push({
        sku,
        externalId: orderNumber,
        orderDate,
        qty,
        salePriceGrossPence: itemsPence,
        saleVatPence: deemedItemTax ? Math.abs(toPence(deemedItemTax)) : null,
        feesGrossPence: feesPence,
        feesVatPence,
        feeBreakdown,
        actualShippingCostPence: null, // OnBuy doesn't report your courier cost: shipping rules / profiles are used
        shippingRevenueGrossPence: deliveryPence,
        shippingRevenueVatPence: deemedDeliveryTax ? Math.abs(toPence(deemedDeliveryTax)) : null,
        netProceedsPence,
      })
    }

    setAllOrders(parsed)
    setStatus(
      `Found ${parsed.length} order lines.` +
      (skipped ? ` Skipped ${skipped} row(s) that aren't sales (e.g. refunds, handled later).` : '') +
      (mismatched ? ` Warning: ${mismatched} row(s) don't add up to OnBuy's Net Proceeds, please check them.` : '') +
      ' Review below, then confirm.'
    )
  }

  async function handleImport(progress: (message: string) => void) {
    if (allOrders.length === 0) {
      return 'Nothing to import yet: please choose a file first.'
    }
    if (!store) {
      return 'Please select which store this export is from first.'
    }
    const result = await importOrdersForStore(store, allOrders, progress, { createUnknownSkus })
    return [importResultSummary(result, store)]
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>OnBuy Import</h1>
      <p style={pageIntro}>Upload the OnBuy transaction report (Excel or CSV). One row per order line; sales fees and Boost fees are both counted as fees.</p>

      <div style={cardStyle}>
        <StorePicker platformFilter={(p) => p.integration_type === 'onbuy'} value={store} onChange={setStore} />
        <CreateProductsToggle checked={createUnknownSkus} onChange={setCreateUnknownSkus} />

        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '16px', display: 'block' }} />
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
                  <th style={thStyle}>Date paid</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Sale price</th>
                  <th style={thStyle}>Delivery</th>
                  <th style={thStyle}>Fees (inc. VAT)</th>
                  <th style={thStyle}>Net proceeds</th>
                </tr>
              </thead>
              <tbody>
                {allOrders.slice(0, 20).map((row) => (
                  <tr key={row.externalId + row.sku}>
                    <td style={tdStyle}>{row.externalId}</td>
                    <td style={tdStyle}>{row.sku}</td>
                    <td style={tdStyle}>{ukDate(row.orderDate)}</td>
                    <td style={tdStyle}>{row.qty}</td>
                    <td style={tdStyle}>{pounds(row.salePriceGrossPence)}</td>
                    <td style={tdStyle}>{pounds(row.shippingRevenueGrossPence ?? 0)}</td>
                    <td style={tdStyle}>{pounds(row.feesGrossPence)}</td>
                    <td style={tdStyle}>{pounds(row.netProceedsPence)}</td>
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
