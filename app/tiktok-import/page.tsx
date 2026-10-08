'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { importOrdersForStore, importResultSummary, NormalizedOrder } from '@/lib/importEngine'
import ConfirmImport from '@/components/ConfirmImport'
import { readSpreadsheet, toIsoDate } from '@/lib/readSpreadsheet'
import { Store } from '@/lib/stores'
import { FeeLine, FeeType, addFee, feeTotals, shareVat } from '@/lib/fees'
import { pounds, ukDate } from '@/lib/format'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, statusColor } from '@/lib/theme'

// The parts of TikTok's "Fees" total, each with its fee type. vat = TikTok's own fees, which
// include 20% UK VAT; affiliate commission (paid to creators, mostly not VAT registered) and
// seller-funded promotions carry no reclaimable VAT. Anything in "Fees" not listed here is
// saved as "Not broken down" and flagged, so new columns get noticed.
const FEE_COLUMNS: { column: string; type: FeeType; vat: boolean }[] = [
  { column: 'TikTok Shop commission fee', type: 'commission', vat: true },
  { column: 'Shipping service fee', type: 'shipping', vat: true },
  { column: 'Managed service plan (Per order fee)', type: 'other_fee', vat: true },
  { column: 'Campaign resource fee', type: 'advertising', vat: true },
  { column: 'Campaign service fee', type: 'advertising', vat: true },
  { column: 'Smart Promotion fee', type: 'advertising', vat: true },
  { column: 'GMV Max ad fee', type: 'advertising', vat: true },
  { column: 'Affiliate Commission', type: 'affiliate', vat: false },
  { column: 'Affiliate partner commission', type: 'affiliate', vat: false },
  { column: 'Affiliate Shop Ads commission', type: 'affiliate', vat: false },
  { column: 'Affiliate Partner shop ads commission', type: 'affiliate', vat: false },
  { column: 'Affiliate commission deposit', type: 'affiliate', vat: false },
  { column: 'Affiliate commission refund', type: 'affiliate', vat: false },
  { column: 'Co-funded promotion (seller-funded)', type: 'advertising', vat: false },
]

const toPence = (value: string | undefined) => Math.round((parseFloat(value || '') || 0) * 100)
// IDs must be whole digit strings; "1.72964E+18" means the file was opened and saved in Excel
const isId = (value: string) => /^\d+$/.test(value)

type Parsed = NormalizedOrder & { orderId: string; skuId: string; settlementPence: number }

export default function TikTokImportPage() {
  const [store, setStore] = useState<Store | null>(null)
  const [createUnknownSkus, setCreateUnknownSkus] = useState(false)
  const [status, setStatus] = useState('')
  const [allOrders, setAllOrders] = useState<Parsed[]>([])

  // Rows were matched against one store's SKU IDs, so switching store means choosing the file again
  function changeStore(newStore: Store | null) {
    setStore(newStore)
    setAllOrders([])
    setStatus('')
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!store) {
      setStatus('Please choose which store this file is from first.')
      return
    }

    setStatus('Reading file...')
    let rows: Record<string, string>[]
    try {
      // The statement can be a workbook with several tabs: use the one with the order lines
      rows = await readSpreadsheet(file, ['Order created date'], { sheetWithColumn: 'Order/adjustment ID' })
    } catch (err) {
      setStatus(`Error: could not read the file (${err instanceof Error ? err.message : err}).`)
      return
    }
    if (rows.length > 0 && !('Order/adjustment ID' in rows[0] && 'SKU ID' in rows[0] && 'Net sales' in rows[0] && 'Fees' in rows[0])) {
      setStatus('Error: this doesn\'t look like a TikTok Shop statement (no "Order/adjustment ID" / "SKU ID" / "Net sales" / "Fees" columns).')
      return
    }

    // TikTok SKU ID -> your SKU, from each listing's TikTok SKU ID in this store
    const { data: skuIdRows, error: skuIdError } = await fetchAll((from, to) =>
      supabase.from('channel_sku_ids').select('sku_id, seller_sku').eq('store_id', store.id).order('sku_id').range(from, to)
    )
    if (skuIdError) {
      setStatus(`Error loading TikTok SKU IDs: ${skuIdError.message}`)
      return
    }
    const sellerSkuOf = new Map(skuIdRows.map((c) => [String(c.sku_id), c.seller_sku as string]))

    const parsed: Parsed[] = []
    const otherTypes = new Map<string, number>() // adjustments etc., handled later
    const unmatchedIds = new Set<string>()
    let refundsSkipped = 0
    let badIds = 0
    let badRows = 0
    let feesNotSplit = 0
    let mismatched = 0
    for (const row of rows) {
      const type = (row['Type'] || '').trim()
      if (type !== 'Order') {
        if (type) otherTypes.set(type, (otherTypes.get(type) || 0) + 1)
        continue
      }
      // Net sales = gross sales less seller-funded discounts and any refund on the same row.
      // Platform-funded discounts are paid by TikTok, so they don't reduce what you earn.
      // Fully refunded (0) and refund-only (negative) rows are skipped for now.
      const netSalesPence = toPence(row['Net sales'])
      if (netSalesPence <= 0) {
        refundsSkipped++
        continue
      }
      const orderId = (row['Order/adjustment ID'] || '').trim()
      const skuId = (row['SKU ID'] || '').trim()
      if (!isId(orderId) || !isId(skuId)) {
        badIds++
        continue
      }
      const orderDate = toIsoDate((row['Order created date'] || '').trim().replace(/\//g, '-'))
      if (!orderDate) {
        badRows++
        continue
      }
      const sellerSku = sellerSkuOf.get(skuId)
      if (!sellerSku) unmatchedIds.add(skuId)

      // Fees are negative in the file, so flip the sign to get a cost (a refunded fee comes out negative)
      const feesSigned = toPence(row['Fees'])
      const feeSign = feesSigned < 0 ? -1 : 1
      const feesGrossPence = Math.abs(feesSigned)
      const feeBreakdown: FeeLine[] = []
      const vatLines: FeeLine[] = []
      for (const fee of FEE_COLUMNS) {
        const cost = toPence(row[fee.column]) * feeSign
        if (!cost) continue
        addFee(feeBreakdown, fee.type, fee.column, cost)
        if (fee.vat) vatLines.push(feeBreakdown.find((l) => l.label === fee.column)!)
      }
      if (feeTotals(feeBreakdown).grossPence !== feesGrossPence) feesNotSplit++
      // VAT = 1/6 of TikTok's own (VAT-inclusive) fees, i.e. everything except affiliate / seller-funded promotion
      const noVatPence = feeBreakdown.filter((l) => !vatLines.includes(l)).reduce((sum, l) => sum + l.grossPence, 0)
      const feesVatPence = Math.round((feesGrossPence - noVatPence) / 6)
      shareVat(vatLines, feesVatPence)

      // "Shipping" is what you paid TikTok for the label (negative), if TikTok shipped it
      const shippingPence = toPence(row['Shipping'])
      // TikTok only fills "VAT" when it collects the VAT itself (e.g. overseas sellers);
      // for UK sellers it's 0 and the VAT is worked out from the product's VAT rate
      const saleVatPence = Math.abs(toPence(row['VAT']))

      // Check our reading against TikTok's own settlement figure
      const settlementPence = toPence(row['Total settlement amount'])
      if (Math.abs(netSalesPence + feesSigned + shippingPence - settlementPence) > 1) mismatched++

      parsed.push({
        sku: sellerSku || skuId, // unknown IDs fall back to the raw number, so they're held back
        externalId: `${orderId}_${skuId}`,
        orderId,
        skuId,
        orderDate,
        qty: parseInt(row['Quantity']) || 1,
        salePriceGrossPence: netSalesPence,
        saleVatPence: saleVatPence || null,
        feesGrossPence,
        feesVatPence,
        feeBreakdown,
        actualShippingCostPence: shippingPence !== 0 ? Math.abs(shippingPence) : null,
        settlementPence,
      })
    }

    setAllOrders(parsed)
    setStatus(
      `Found ${parsed.length} order lines.` +
      (refundsSkipped ? ` Skipped ${refundsSkipped} fully refunded or refund-only row(s) (TikTok refunds come later).` : '') +
      (otherTypes.size ? ` Skipped rows that aren't orders (handled later): ${Array.from(otherTypes, ([t, n]) => `${n} ${t}`).join(', ')}.` : '') +
      (badIds ? ` Warning: skipped ${badIds} row(s) whose order or SKU ID isn't a whole number (e.g. 1.72964E+18). That happens when the file is opened and saved in Excel: download it again from TikTok and upload it without opening it.` : '') +
      (badRows ? ` Warning: skipped ${badRows} row(s) with no order date.` : '') +
      (unmatchedIds.size
        ? ` Warning: ${unmatchedIds.size} TikTok SKU ID(s) aren't on any product yet: ${Array.from(unmatchedIds).slice(0, 10).join(', ')}${unmatchedIds.size > 10 ? ' and more' : ''}. Add each one to its product's store SKU for this TikTok store (on the product's page, or the TikTok catalog upload on Store SKUs), then choose this file again. If you confirm now, those sales are held back (don't tick "Create new products" here, or you'll get products named after TikTok's numbers).`
        : '') +
      (feesNotSplit ? ` Note: on ${feesNotSplit} row(s) part of TikTok's fees is in a column Margin Hero doesn't recognise yet; it's counted, as "Not broken down".` : '') +
      (mismatched ? ` Warning: ${mismatched} row(s) don't add up to TikTok's Total settlement amount, please check them.` : '') +
      ' Review below, then confirm.'
    )
  }

  async function handleImport(progress: (message: string) => void) {
    if (allOrders.length === 0) {
      return 'Nothing to import yet: please choose a file first.'
    }
    if (!store) {
      return 'Please choose which store this file is from first.'
    }
    const result = await importOrdersForStore(store, allOrders, progress, { createUnknownSkus })
    return [importResultSummary(result, store)]
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>TikTok Import</h1>
      <p style={pageIntro}>
        Upload your TikTok Shop statement (Excel or CSV) as TikTok gives it: if it has several tabs, the order lines are found
        automatically. TikTok&apos;s report shows its own <strong>SKU ID</strong> instead of your SKU, so each product&apos;s store SKU for
        this TikTok store needs its SKU ID too. Sales only for now: refunds come later. Don&apos;t open and re-save the file in Excel
        first, as Excel rounds TikTok&apos;s long ID numbers.
      </p>
      <div style={cardStyle}>
        <StorePicker platformFilter={(p) => p.name === 'TikTok'} value={store} onChange={changeStore} />
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
                  <th style={thStyle}>TikTok SKU ID</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Net sales</th>
                  <th style={thStyle}>Fees (inc. VAT)</th>
                  <th style={thStyle}>Shipping</th>
                  <th style={thStyle}>Settlement</th>
                </tr>
              </thead>
              <tbody>
                {allOrders.slice(0, 20).map((row) => (
                  <tr key={row.externalId}>
                    <td style={tdStyle}>{row.orderId}</td>
                    <td style={tdStyle}>{row.sku === row.skuId ? '—' : row.sku}</td>
                    <td style={tdStyle}>{row.skuId}</td>
                    <td style={tdStyle}>{ukDate(row.orderDate)}</td>
                    <td style={tdStyle}>{row.qty}</td>
                    <td style={tdStyle}>{pounds(row.salePriceGrossPence)}</td>
                    <td style={tdStyle}>{pounds(row.feesGrossPence)}</td>
                    <td style={tdStyle}>{row.actualShippingCostPence ? pounds(row.actualShippingCostPence) : '—'}</td>
                    <td style={tdStyle}>{pounds(row.settlementPence)}</td>
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
