'use client'

import { ukDate } from '@/lib/format'
import { useState } from 'react'
import * as XLSX from 'xlsx'
import { importOrdersForStore, importResultSummary, NormalizedOrder } from '@/lib/importEngine'
import ConfirmImport from '@/components/ConfirmImport'
import { Store } from '@/lib/stores'
import { FeeLine, FeeType, addFee, feeTotals } from '@/lib/fees'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, statusColor } from '@/lib/theme'

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

      const typeOf = (row: any) => String(row['Type'] || '').trim()
      const amountOf = (row: any) => parseFloat(row['Amount']) || 0
      // Refund rows are skipped for now (handled later)
      const isRefund = (type: string) => /refund/i.test(type)
      // Every fee the retailer charges counts, not just commission: e.g. The Range adds
      // "Seller fee on order" (MARK_FEE, PAY_GATE_FEE). Their "... tax ..." rows are the VAT.
      const isFee = (type: string) => /commission|fee/i.test(type) && !isRefund(type)
      const isFeeTax = (type: string) => isFee(type) && /tax/i.test(type)
      // A fee and its tax row are saved together under the fee's name, e.g. "Commission" + "Commission tax"
      const feeLabel = (type: string) => type.replace(/\btax\b/i, '').replace(/\s+/g, ' ').trim() || type
      const feeType = (type: string): FeeType =>
        /commission/i.test(type) ? 'commission' : /pay/i.test(type) ? 'payment' : /ship/i.test(type) ? 'shipping' : 'other_fee'
      // Adds one fee (or fee tax) row to a breakdown, as a cost in pence
      const addFeeRow = (lines: FeeLine[], row: any, costPence: number) => {
        const type = typeOf(row)
        addFee(lines, feeType(type), feeLabel(type), costPence, isFeeTax(type) ? costPence : 0)
      }
      const saleTypes = ['Order amount', 'Order amount tax', 'Shipping charges', 'Shipping tax']

      const refundRows = rows.filter((row) => isRefund(typeOf(row)))
      const unknownTypes = new Set<string>()

      // Most rows belong to an order line. Some fees are charged on the whole order instead
      // (no Order line ID, just the Order number), e.g. The Range's seller fees.
      const groups = new Map<string, any[]>()
      const orderFees = new Map<string, FeeLine[]>() // by Order number
      for (const row of rows) {
        const type = typeOf(row)
        if (!type || isRefund(type)) continue
        if (!saleTypes.includes(type) && !isFee(type)) {
          unknownTypes.add(type)
          continue
        }
        const lineId = String(row['Order line ID'] || '').trim()
        if (lineId) {
          if (!groups.has(lineId)) groups.set(lineId, [])
          groups.get(lineId)!.push(row)
        } else if (isFee(type) && row['Order number']) {
          const orderNumber = String(row['Order number']).trim()
          const fees = orderFees.get(orderNumber) || []
          addFeeRow(fees, row, Math.round(Math.abs(amountOf(row)) * 100))
          orderFees.set(orderNumber, fees)
        }
      }

      const normalized: NormalizedOrder[] = []
      const orderNumberOf = new Map<NormalizedOrder, string>()
      const noOrderAmount: string[] = [] // order lines held back because the file has no sale price for them
      for (const [orderLineId, groupRows] of groups) {
        const first = groupRows[0]
        const sumByType = (type: string) => groupRows.filter((r) => typeOf(r) === type).reduce((sum, r) => sum + amountOf(r), 0)
        const hasType = (type: string) => groupRows.some((r) => typeOf(r) === type)
        // Some retailers (e.g. B&Q, The Range) give the sale VAT as its own "tax" row, with
        // "Order amount" net of VAT. Others (e.g. Debenhams) have no tax rows: "Order amount"
        // is the full price including VAT, so the VAT is worked out from the product's VAT rate (null).
        const saleTaxReported = hasType('Order amount tax')
        const shippingTaxReported = hasType('Shipping tax')

        const orderAmount = sumByType('Order amount')
        const orderAmountTax = sumByType('Order amount tax')
        const shippingCharge = sumByType('Shipping charges')
        const shippingTax = sumByType('Shipping tax')
        const feeRows = groupRows.filter((r) => isFee(typeOf(r)))
        // Fees are negative in the file, so flip the sign to get a cost
        const feeSign = feeRows.reduce((sum, r) => sum + amountOf(r), 0) < 0 ? -1 : 1
        const feeBreakdown: FeeLine[] = []
        feeRows.forEach((r) => addFeeRow(feeBreakdown, r, Math.round(amountOf(r) * feeSign * 100)))
        const feeTotal = feeTotals(feeBreakdown)

        // A line with fees but no "Order amount" (e.g. a blank row from a damaged CSV) would
        // otherwise import as a £0 sale, so hold it back and say so
        if (!hasType('Order amount') || orderAmount <= 0) {
          noOrderAmount.push(orderLineId)
          continue
        }

        const order: NormalizedOrder = {
          sku: String(first['Offer SKU']).trim(),
          externalId: orderLineId,
          orderDate: parseMiraklDate(first['Transaction Date'] || first['Date created']),
          qty: parseInt(first['Quantity']) || 1,
          salePriceGrossPence: Math.round((orderAmount + orderAmountTax) * 100),
          saleVatPence: saleTaxReported ? Math.round(orderAmountTax * 100) : null,
          feesGrossPence: feeTotal.grossPence,
          feesVatPence: feeTotal.vatPence,
          feeBreakdown,
          actualShippingCostPence: null, // Mirakl doesn't report real courier cost — uses your shipping_rules instead
          shippingRevenueGrossPence: Math.round((shippingCharge + shippingTax) * 100),
          shippingRevenueVatPence: shippingTaxReported ? Math.round(shippingTax * 100) : null,
        }
        normalized.push(order)
        orderNumberOf.set(order, String(first['Order number'] || '').trim())
      }

      // Share each order-level fee across that order's lines by sale price. The last line
      // takes any leftover penny so the lines always add up to the order's fee exactly.
      let unallocatedFeePence = 0
      for (const [orderNumber, fees] of orderFees) {
        const lines = normalized.filter((o) => orderNumberOf.get(o) === orderNumber)
        if (lines.length === 0) {
          unallocatedFeePence += feeTotals(fees).grossPence
          continue
        }
        const totalSale = lines.reduce((sum, o) => sum + o.salePriceGrossPence, 0)
        for (const fee of fees) {
          let grossLeft = fee.grossPence
          let vatLeft = fee.vatPence
          lines.forEach((o, i) => {
            const last = i === lines.length - 1
            const share = totalSale > 0 ? o.salePriceGrossPence / totalSale : 1 / lines.length
            const gross = last ? grossLeft : Math.round(fee.grossPence * share)
            const vat = last ? vatLeft : Math.round(fee.vatPence * share)
            o.feesGrossPence += gross
            o.feesVatPence += vat
            addFee((o.feeBreakdown ??= []), fee.type, fee.label, gross, vat)
            grossLeft -= gross
            vatLeft -= vat
          })
        }
      }

      setAllOrders(normalized)
      setPreview(normalized.slice(0, 20))
      setSkippedRefunds(refundRows.length)
      setStatus(
        `Found ${normalized.length} order lines. Skipped ${refundRows.length} refund-related rows (handled later).` +
        (orderFees.size ? ` Order-level seller fees from ${orderFees.size} order(s) were shared across their order lines.` : '') +
        (noOrderAmount.length
          ? ` Warning: held back ${noOrderAmount.length} order line(s) with no "Order amount" in the file, so they won't be imported: ${noOrderAmount.slice(0, 10).join(', ')}${noOrderAmount.length > 10 ? ' and more' : ''}. Check the file (a blank row usually means it was damaged when saved as CSV).`
          : '') +
        (unallocatedFeePence ? ` Warning: £${(unallocatedFeePence / 100).toFixed(2)} of order-level fees belong to orders with no imported lines, so they aren't counted.` : '') +
        (unknownTypes.size ? ` Warning: ignored rows of a type Margin Hero doesn't recognise yet: ${Array.from(unknownTypes).join(', ')}. Please check these.` : '') +
        ' Review below, then confirm.'
      )
    }
    reader.readAsBinaryString(file)
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
      <h1 style={pageTitle}>Mirakl Import</h1>
      <p style={pageIntro}>Used for B&Q, The Range, Debenhams, Tesco and Argos — same underlying report format, different retailer.</p>

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
                <th style={thStyle}>Sale VAT</th>
                <th style={thStyle}>Fees</th>
                <th style={thStyle}>Shipping Revenue</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.externalId}>
                  <td style={tdStyle}>{row.sku}</td>
                  <td style={tdStyle}>{ukDate(row.orderDate)}</td>
                  <td style={tdStyle}>{row.qty}</td>
                  <td style={tdStyle}>£{(row.salePriceGrossPence / 100).toFixed(2)}</td>
                  <td style={tdStyle}>{row.saleVatPence === null ? 'From product rate' : `£${(row.saleVatPence / 100).toFixed(2)}`}</td>
                  <td style={tdStyle}>£{(row.feesGrossPence / 100).toFixed(2)}</td>
                  <td style={tdStyle}>£{((row.shippingRevenueGrossPence || 0) / 100).toFixed(2)}</td>
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
