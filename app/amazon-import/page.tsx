'use client'

import { pounds, ukDate } from '@/lib/format'
import { useState } from 'react'
import { readSpreadsheet, toIsoDate } from '@/lib/readSpreadsheet'
import { importOrdersForStore, importResultSummary, ImportSummaryData, NormalizedOrder, NormalizedRefund } from '@/lib/importEngine'
import { Store } from '@/lib/stores'
import { FeeLine, addFee, feeTotals, shareVat } from '@/lib/fees'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import ImportSummary from '@/components/ImportSummary'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, statusColor } from '@/lib/theme'

// Amazon's transaction report (Reports Repository → Date Range Reports → Transaction):
// one row per order line, refund or account-level transaction, with the money already in
// columns. Notes sit above the table, so it's read from the "date/time" heading row.
// The order city / state / postal columns are buyer details and are never read or stored.
type AmazonRow = Record<string, string> & {
  'date/time': string
  type: string
  'order id': string
  sku: string
  description: string
  quantity: string
  fulfilment: string // "Seller" = you ship it (incl. Seller Fulfilled Prime), "Amazon" = FBA
  total: string
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }

// "31 Jul 2026 23:58:13 UTC" (also "15 Sept 2026 01:48:59") -> the UK calendar date, so a sale
// just before midnight UK time lands on the right day. Excel-saved files fall back to toIsoDate.
function amazonDate(text: string): string {
  const m = (text || '').trim().match(/^(\d{1,2}) ([A-Za-z]{3,4})\w* (\d{4})(?: (\d{1,2}):(\d{2}):(\d{2}))?/)
  const month = m ? MONTHS[m[2].toLowerCase()] : undefined
  if (!m || !month) return toIsoDate(text) ?? ''
  const utc = new Date(Date.UTC(+m[3], month - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)))
  if (isNaN(utc.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(utc)
}

// Amounts are plain numbers, except big ones may have a thousands comma ("1,234.56")
const pence = (row: AmazonRow, column: string) => Math.round((parseFloat((row[column] || '').replace(/,/g, '')) || 0) * 100)

// The three fee columns (negative = charged). Matched against the settlement report:
// selling fees = Commission (+ ShippingHB holdbacks), fba fees = FBA fulfilment fee
// (+ delivery / gift wrap chargebacks), other transaction fees = Digital Services Fee.
function fees(row: AmazonRow): FeeLine[] {
  const lines: FeeLine[] = []
  addFee(lines, 'commission', 'Selling fees', -pence(row, 'selling fees'))
  addFee(lines, 'fulfilment', 'FBA fees', -pence(row, 'fba fees'))
  addFee(lines, 'other_fee', 'Other transaction fees', -pence(row, 'other transaction fees'))
  return lines
}

// Amazon doesn't give the VAT on fees, so it's taken as 20% of the total and shared across them
function withFeeVat(lines: FeeLine[]) {
  const grossPence = feeTotals(lines).grossPence
  const vatPence = Math.round(grossPence - grossPence / 1.2)
  shareVat(lines, vatPence)
  return { grossPence, vatPence }
}

// Shares an order's label cost across its lines by price (last line takes the leftover penny)
function share<T>(items: T[], totalPence: number, weight: (item: T) => number, set: (item: T, pence: number) => void) {
  const totalWeight = items.reduce((sum, i) => sum + weight(i), 0)
  let left = totalPence
  items.forEach((item, i) => {
    const last = i === items.length - 1
    const part = last ? left : totalWeight > 0 ? Math.round((totalPence * weight(item)) / totalWeight) : Math.round(totalPence / items.length)
    set(item, part)
    left -= part
  })
}

// Each sale / refund remembers whether Amazon fulfilled it, so it goes to the FBA store
type AmazonOrder = NormalizedOrder & { fba: boolean; orderId: string }
type AmazonRefund = NormalizedRefund & { fba: boolean; orderId: string }
const isFba = (row: AmazonRow) => (row.fulfilment || '').trim().toLowerCase() === 'amazon'

// Outbound labels bought through Amazon, plus the carrier's later adjustments and refunded
// labels ("Delivery Label Refunded though Amazon", Amazon's spelling): all per order, not per line
const isOutboundLabel = (row: AmazonRow) =>
  row.type === 'Delivery Services' && /label/i.test(row.description) && !/return/i.test(row.description)
const isReturnLabel = (row: AmazonRow) => row.type === 'Delivery Services' && row.description === 'ReturnPostageBilling'

const n = (count: number) => count.toLocaleString('en-GB')

export default function AmazonImportPage() {
  const [status, setStatus] = useState<string>('')
  const [summary, setSummary] = useState<ImportSummaryData | null>(null) // what's in the file, shown before import
  const [importing, setImporting] = useState(false) // locks the button so an import can't run twice at once
  const [importStatus, setImportStatus] = useState('') // progress / problems, shown by the button
  const [results, setResults] = useState<ImportSummaryData[]>([]) // one per store, shown by the button
  const [preview, setPreview] = useState<AmazonOrder[]>([])
  const [allOrders, setAllOrders] = useState<AmazonOrder[]>([])
  const [allRefunds, setAllRefunds] = useState<AmazonRefund[]>([])
  const [store, setStore] = useState<Store | null>(null) // fulfilled by you (incl. Seller Fulfilled Prime)
  const [fbaStore, setFbaStore] = useState<Store | null>(null) // fulfilled by Amazon (FBA)
  const [createUnknownSkus, setCreateUnknownSkus] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setSummary(null)
    setResults([])
    setImportStatus('')
    setStatus('Reading file, this may take a moment for large files...')

    let data: AmazonRow[]
    try {
      data = (await readSpreadsheet(file, ['date/time'], { headerStartsWith: 'date/time' })) as AmazonRow[]
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus(
        `Error reading file: ${message}.` +
        (/heading row/.test(message) ? ' This page reads the Transaction report from Reports Repository (Date Range Reports), not the settlement statement.' : '')
      )
      return
    }

    // Sales: one row per product per order. The order ID is the line's ID (unique per store SKU);
    // the same SKU twice in one order is added together.
    const ordersByKey = new Map<string, AmazonOrder>()
    for (const row of data) {
      if (row.type !== 'Order' || !row['order id'] || !row.sku) continue
      const orderId = row['order id']
      const feeBreakdown = fees(row)
      // Postage charged to the buyer, less promotions (Amazon's promotions here are free-delivery
      // discounts; any promotion bigger than the postage comes off the item price instead)
      let shipGross = pence(row, 'postage credits') + pence(row, 'shipping credits tax') + pence(row, 'promotional rebates') + pence(row, 'promotional rebates tax')
      let shipVat = pence(row, 'shipping credits tax') + pence(row, 'promotional rebates tax')
      let itemGross = pence(row, 'product sales') + pence(row, 'product sales tax') + pence(row, 'gift wrap credits') + pence(row, 'giftwrap credits tax')
      let itemVat = pence(row, 'product sales tax') + pence(row, 'giftwrap credits tax')
      if (shipGross < 0) {
        itemGross += shipGross
        itemVat += shipVat
        shipGross = 0
        shipVat = 0
      }
      // Anything in "other" on a sale is unusual; counted as a fee (negative = a cost)
      addFee(feeBreakdown, 'other_fee', 'Other', -pence(row, 'other'))

      const key = `${orderId}|${row.sku}`
      const existing = ordersByKey.get(key)
      if (existing) {
        existing.qty += parseInt(row.quantity) || 0
        existing.salePriceGrossPence += itemGross
        existing.saleVatPence = (existing.saleVatPence ?? 0) + itemVat
        existing.shippingRevenueGrossPence = (existing.shippingRevenueGrossPence ?? 0) + shipGross
        existing.shippingRevenueVatPence = (existing.shippingRevenueVatPence ?? 0) + shipVat
        for (const f of feeBreakdown) addFee(existing.feeBreakdown!, f.type, f.label, f.grossPence)
        continue
      }
      ordersByKey.set(key, {
        orderId,
        sku: row.sku,
        externalId: orderId,
        orderDate: amazonDate(row['date/time']),
        qty: parseInt(row.quantity) || 1,
        salePriceGrossPence: itemGross,
        saleVatPence: itemVat,
        shippingRevenueGrossPence: shipGross,
        shippingRevenueVatPence: shipVat,
        feesGrossPence: 0,
        feesVatPence: 0,
        feeBreakdown,
        actualShippingCostPence: null, // filled in from the order's labels below
        fba: isFba(row),
      })
    }
    const normalized = Array.from(ordersByKey.values())
    for (const o of normalized) {
      const { grossPence, vatPence } = withFeeVat(o.feeBreakdown!)
      o.feesGrossPence = grossPence
      o.feesVatPence = vatPence
    }

    // Label cost per order (bought, adjusted, refunded), shared across the order's lines by
    // price, so a multi-item order sent in one parcel isn't charged the label on every line
    const linesByOrderId = new Map<string, AmazonOrder[]>()
    for (const o of normalized) {
      if (!linesByOrderId.has(o.orderId)) linesByOrderId.set(o.orderId, [])
      linesByOrderId.get(o.orderId)!.push(o)
    }
    const labelsByOrderId = new Map<string, number>()
    const purchasedLabel = new Set<string>()
    for (const row of data) {
      if (!isOutboundLabel(row) || !row['order id']) continue
      labelsByOrderId.set(row['order id'], (labelsByOrderId.get(row['order id']) || 0) - pence(row, 'total'))
      if (/purchased/i.test(row.description)) purchasedLabel.add(row['order id'])
    }
    // Labels are bought on the day of the sale, but carrier adjustments and label refunds can
    // come weeks later, for sales in an earlier file. Those can't be added to an imported sale
    // yet, so they're totalled in the status (and an adjustment alone never replaces a profile).
    let unmatchedLabels = 0
    let laterCorrections = 0
    let laterCorrectionsPence = 0
    for (const [orderId, labelPence] of labelsByOrderId) {
      const lines = linesByOrderId.get(orderId)
      if (!purchasedLabel.has(orderId)) {
        laterCorrections++
        laterCorrectionsPence += labelPence
        continue
      }
      if (!lines) {
        unmatchedLabels++
        continue
      }
      share(lines, labelPence, (o) => o.salePriceGrossPence, (o, p) => { o.actualShippingCostPence = p })
    }

    // Refunds: amounts are negative for money given back, positive for fees Amazon returns.
    // Each refund links to its sale by order ID (+ SKU); several refunds on one line are kept apart by time.
    const refundsByKey = new Map<string, AmazonRefund>()
    for (const row of data) {
      if (row.type !== 'Refund' || !row['order id'] || !row.sku) continue
      const key = `${row['order id']}|${row.sku}|${row['date/time']}`
      // "other" on a refund is a goodwill payment: extra money given back, no VAT
      const refundGross = -(pence(row, 'product sales') + pence(row, 'product sales tax') + pence(row, 'gift wrap credits') + pence(row, 'giftwrap credits tax') + pence(row, 'other'))
      const refundVat = -(pence(row, 'product sales tax') + pence(row, 'giftwrap credits tax'))
      const shipGross = -(pence(row, 'postage credits') + pence(row, 'shipping credits tax') + pence(row, 'promotional rebates') + pence(row, 'promotional rebates tax'))
      const shipVat = -(pence(row, 'shipping credits tax') + pence(row, 'promotional rebates tax'))
      // As a cost: fees given back (positive in the file) reduce it, less Amazon's refund admin fee
      const feeBreakdown = fees(row)
      const existing = refundsByKey.get(key)
      if (existing) {
        existing.refundGrossPence += refundGross
        existing.refundVatPence = (existing.refundVatPence ?? 0) + refundVat
        existing.shippingRefundGrossPence = (existing.shippingRefundGrossPence ?? 0) + shipGross
        existing.shippingRefundVatPence = (existing.shippingRefundVatPence ?? 0) + shipVat
        for (const f of feeBreakdown) addFee(existing.feeBreakdown!, f.type, f.label, f.grossPence)
        continue
      }
      refundsByKey.set(key, {
        orderId: row['order id'],
        fba: isFba(row),
        sku: row.sku,
        externalId: `${row['order id']}_${row['date/time']}`,
        originalExternalId: row['order id'],
        refundDate: amazonDate(row['date/time']),
        // Amazon says 1 even on partial / goodwill refunds, so units are worked out from the refunded price
        qty: null,
        refundGrossPence: refundGross,
        refundVatPence: refundVat,
        shippingRefundGrossPence: shipGross,
        shippingRefundVatPence: shipVat,
        feesGrossPence: 0,
        feesVatPence: 0,
        feeBreakdown,
        returnShippingCostPence: null,
      })
    }
    const refunds = Array.from(refundsByKey.values())
    for (const r of refunds) {
      const { grossPence, vatPence } = withFeeVat(r.feeBreakdown!)
      r.feesGrossPence = grossPence
      r.feesVatPence = vatPence
    }

    // Return labels bought through Amazon only have the order ID, so they're added to that
    // order's refunds in this file (shared by refunded price if there are several)
    const returnLabels = new Map<string, number>()
    for (const row of data) {
      if (isReturnLabel(row) && row['order id']) returnLabels.set(row['order id'], (returnLabels.get(row['order id']) || 0) - pence(row, 'total'))
    }
    let unmatchedReturnLabels = 0
    for (const [orderId, labelPence] of returnLabels) {
      const lines = refunds.filter((r) => r.orderId === orderId)
      if (lines.length === 0) {
        unmatchedReturnLabels++
        continue
      }
      share(lines, labelPence, (r) => r.refundGrossPence, (r, p) => { r.returnShippingCostPence = p })
    }

    // Account-level rows Margin Hero doesn't use yet, listed so nothing is skipped silently.
    // Transfers (payouts to your bank) aren't costs; Cost of Advertising comes in via Amazon Ads.
    const otherRows = new Map<string, number>()
    let adRows = 0
    for (const row of data) {
      const type = (row.type || '').trim()
      if (!type || type === 'Order' || type === 'Refund' || type === 'Transfer' || isOutboundLabel(row) || isReturnLabel(row)) continue
      if (/cost of advertising/i.test(row.description)) {
        adRows++
        continue
      }
      const what = /^SAFE-T/i.test(type)
        ? 'SAFE-T reimbursements'
        : (row.description || type)
            .replace(/^Fulfilment by Amazon \(FBA\) /, 'FBA ')
            .replace(/^FBA Inventory Reimbursement - /, 'FBA reimbursement: ')
            .replace(/:$/, '')
      otherRows.set(what, (otherRows.get(what) || 0) + 1)
    }

    // A date that couldn't be read would put the sale on the wrong day, so stop here
    const badDates = normalized.filter((o) => !o.orderDate).length + refunds.filter((r) => !r.refundDate).length
    if (badDates > 0) {
      setAllOrders([])
      setAllRefunds([])
      setPreview([])
      setStatus(`Error: ${badDates} line(s) have a date/time that couldn't be read. Expected Amazon's format, like 31 Aug 2026 10:12:13 UTC.`)
      return
    }

    setAllOrders(normalized)
    setAllRefunds(refunds)
    setPreview(normalized.slice(0, 20))
    const fbaLines = normalized.filter((o) => o.fba).length + refunds.filter((r) => r.fba).length
    const labelled = normalized.filter((o) => o.actualShippingCostPence !== null).length
    const sections: ImportSummaryData['sections'] = [
      {
        title: 'Found',
        items: [
          fbaLines ? `${n(fbaLines)} fulfilled by Amazon (FBA): these go to your FBA store` : '',
          labelled ? `${n(labelled)} order lines with a delivery label bought through Amazon: the real label cost is used` : '',
        ],
      },
      {
        title: 'Skipped on purpose',
        items: [adRows ? `${n(adRows)} × Cost of Advertising: import ad spend on Amazon Ads instead, so it isn't counted twice` : ''],
      },
      {
        title: 'Not imported yet',
        items: Array.from(otherRows).sort((a, b) => b[1] - a[1]).map(([what, count]) => `${n(count)} × ${what}`),
      },
      {
        title: 'Good to know',
        items: [
          laterCorrections
            ? `Carrier adjustments / refunded labels on ${n(laterCorrections)} orders from before these dates aren't counted yet (${laterCorrectionsPence < 0 ? `${pounds(-laterCorrectionsPence)} back to you` : `${pounds(laterCorrectionsPence)} extra`})`
            : '',
          unmatchedLabels ? `${n(unmatchedLabels)} delivery labels are for sales outside these dates, so they aren't counted` : '',
          unmatchedReturnLabels ? `${n(unmatchedReturnLabels)} return labels are for refunds outside these dates, so they aren't counted` : '',
        ],
      },
    ]
    setSummary({
      headline: `Ready to import ${n(normalized.length)} order lines and ${n(refunds.length)} refunds`,
      tone: 'ok',
      sections: sections.map((sec) => ({ ...sec, items: sec.items.filter(Boolean) })).filter((sec) => sec.items.length > 0),
    })
    setStatus('')
  }

  // Progress and results are shown by the button (where you are when you click it), and the
  // button is locked while it runs: a second click mid-import could save the same orders twice.
  async function handleImport() {
    if (importing) return
    if (allOrders.length === 0 && allRefunds.length === 0) {
      setImportStatus('Nothing to import yet: please choose a file first.')
      return
    }
    const hasOwn = allOrders.some((o) => !o.fba) || allRefunds.some((r) => !r.fba)
    const hasFba = allOrders.some((o) => o.fba) || allRefunds.some((r) => r.fba)
    if (hasOwn && !store) {
      setImportStatus('Missing store: choose your Amazon store (you ship) at the top of the page first.')
      return
    }
    if (hasFba && !fbaStore) {
      setImportStatus(
        'Missing FBA store: this file has orders fulfilled by Amazon (FBA). Choose your FBA store at the top of the page, or add one on the Stores page ' +
        '(e.g. "Amazon UK FBA", with "Fulfilled by the channel" ticked), then try again.'
      )
      return
    }

    setImporting(true)
    setResults([])
    const done: ImportSummaryData[] = []
    try {
      for (const [target, fba] of [[store, false], [fbaStore, true]] as const) {
        const orders = allOrders.filter((o) => o.fba === fba)
        const refunds = allRefunds.filter((r) => r.fba === fba)
        if (!target || (orders.length === 0 && refunds.length === 0)) continue
        const result = await importOrdersForStore(target, orders, (msg) => setImportStatus(`${target.name}: ${msg}`), { createUnknownSkus, refunds })
        done.push(importResultSummary(result, target))
        setResults([...done])
      }
      setImportStatus('')
    } catch (err) {
      setImportStatus(`Error: the import stopped: ${err instanceof Error ? err.message : String(err)}. Uploading the same file again is safe: already-imported orders are skipped.`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>Amazon Import</h1>
      <p style={pageIntro}>Upload the Transaction report from Reports Repository (Date Range Reports), for any dates you like, even years back.
        Sales, refunds and delivery labels bought through Amazon are imported together. Orders Amazon fulfilled (FBA) go to your FBA store,
        the rest (including Seller Fulfilled Prime) to your own-shipping store. Reimbursements and FBA storage fees are skipped for now.</p>
      <div style={cardStyle}>
      <StorePicker platformFilter={(p) => p.name.startsWith('Amazon')} storeFilter={(st) => !st.fulfilled_by_channel} label="Store (you ship)" value={store} onChange={setStore} />
      <div style={{ marginTop: '10px' }}>
        <StorePicker platformFilter={(p) => p.name.startsWith('Amazon')} storeFilter={(st) => st.fulfilled_by_channel} label="FBA store (Amazon ships)" optional value={fbaStore} onChange={setFbaStore} />
      </div>
      <CreateProductsToggle checked={createUnknownSkus} onChange={setCreateUnknownSkus} />
      <input type="file" accept=".csv,.txt,.xlsx,.xls" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '16px', display: 'block' }} />
      {status && <p style={{ color: statusColor(status), fontSize: '14px', fontWeight: 600, margin: '16px 0 0', lineHeight: 1.5 }}>{status}</p>}
      {summary && (
        <>
          <ImportSummary summary={summary} />
          <p style={{ color: muted, fontSize: '13px', margin: '12px 0 0' }}>Check the preview below, then confirm the import.</p>
        </>
      )}
      </div>

      {(preview.length > 0 || allRefunds.length > 0) && (
        <div style={cardStyle}>
          <p style={cardTitle}>Preview</p>
          {preview.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Order Date</th>
                  <th style={thStyle}>Qty</th>
                  <th style={thStyle}>Sale Price</th>
                  <th style={thStyle}>Postage</th>
                  <th style={thStyle}>Fees</th>
                  <th style={thStyle}>Label</th>
                  <th style={thStyle}>Shipped by</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={`${row.externalId}_${row.sku}`}>
                    <td style={tdStyle}>{row.sku}</td>
                    <td style={tdStyle}>{ukDate(row.orderDate)}</td>
                    <td style={tdStyle}>{row.qty}</td>
                    <td style={tdStyle}>{pounds(row.salePriceGrossPence)}</td>
                    <td style={tdStyle}>{row.shippingRevenueGrossPence ? pounds(row.shippingRevenueGrossPence) : '—'}</td>
                    <td style={tdStyle}>{pounds(row.feesGrossPence)}</td>
                    <td style={tdStyle}>{row.actualShippingCostPence !== null && row.actualShippingCostPence !== undefined ? pounds(row.actualShippingCostPence) : '—'}</td>
                    <td style={tdStyle}>{row.fba ? 'Amazon (FBA)' : 'You'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {allRefunds.length > 0 && (
            <>
              <p style={{ ...cardTitle, margin: preview.length > 0 ? '22px 0 12px' : '0 0 12px' }}>Refunds (first 20)</p>
              <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>SKU</th>
                    <th style={thStyle}>Refund Date</th>
                    <th style={thStyle}>Refunded</th>
                    <th style={thStyle}>Fee change</th>
                    <th style={thStyle}>Return postage</th>
                  </tr>
                </thead>
                <tbody>
                  {allRefunds.slice(0, 20).map((r) => (
                    <tr key={`${r.externalId}_${r.sku}`}>
                      <td style={tdStyle}>{r.sku}</td>
                      <td style={tdStyle}>{ukDate(r.refundDate)}</td>
                      <td style={tdStyle}>{pounds(r.refundGrossPence)}</td>
                      <td style={tdStyle}>{pounds(r.feesGrossPence)}</td>
                      <td style={tdStyle}>{r.returnShippingCostPence ? pounds(r.returnShippingCostPence) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <p style={{ color: muted, fontSize: '13px', margin: '10px 0 0' }}>
                Fee change is what the refund does to your fees: negative = Amazon gave fees back (after keeping its refund fee).
              </p>
            </>
          )}
          <button
            onClick={handleImport}
            disabled={importing}
            style={{ ...primaryButton, marginTop: '18px', ...(importing ? { opacity: 0.6, cursor: 'wait' } : {}) }}
          >
            {importing ? 'Importing, please wait...' : 'Confirm import (every order line and refund in the file, not just the ones shown)'}
          </button>
          {importStatus && (
            <p style={{ color: importing ? muted : statusColor(importStatus), fontSize: '14px', fontWeight: 600, margin: '14px 0 0', lineHeight: 1.5 }}>
              {importStatus}
            </p>
          )}
          {results.map((r) => <ImportSummary key={r.headline} summary={r} />)}
        </div>
      )}
    </div>
  )
}
