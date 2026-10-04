'use client'

import { useState } from 'react'
import { readSpreadsheet, toIsoDate } from '@/lib/readSpreadsheet'
import { importOrdersForStore, describeImportResult, NormalizedOrder } from '@/lib/importEngine'
import { Store } from '@/lib/stores'
import StorePicker from '@/components/StorePicker'
import CreateProductsToggle from '@/components/CreateProductsToggle'
import { lime, red, muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton } from '@/lib/theme'

type ParsedRow = {
  external_id: string
  order_date: string
  platform_sku: string
  qty: string
  sale_price_pounds: string
  sale_vat_pounds: string
  fees_pounds: string
  fees_vat_pounds: string
}

const pence = (pounds: string) => Math.round((parseFloat(pounds) || 0) * 100)

export default function UploadPage() {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [orders, setOrders] = useState<NormalizedOrder[]>([])
  const [invalidRows, setInvalidRows] = useState<number[]>([])
  const [store, setStore] = useState<Store | null>(null)
  const [createUnknownSkus, setCreateUnknownSkus] = useState(false)
  const [status, setStatus] = useState('')

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    readSpreadsheet(file, ['order_date'])
      .then((rows) => processRows(rows as ParsedRow[]))
      .catch((err) => setStatus(`Could not read that file: ${err?.message || err}`))
  }

  function processRows(parsedRows: ParsedRow[]) {
    const normalized: NormalizedOrder[] = []
    const invalid: number[] = []
    parsedRows.forEach((row, i) => {
      const qty = parseInt(row.qty)
      // Rows without an order number, SKU, valid date or quantity can't be imported safely
      if (!row.external_id?.trim() || !row.platform_sku?.trim() || !toIsoDate(row.order_date || '') || !(qty > 0)) {
        invalid.push(i + 2) // +2 = spreadsheet row number (header is row 1)
        return
      }
      normalized.push({
        sku: row.platform_sku.trim(),
        externalId: row.external_id.trim(),
        orderDate: toIsoDate(row.order_date)!,
        qty,
        salePriceGrossPence: pence(row.sale_price_pounds),
        saleVatPence: pence(row.sale_vat_pounds),
        feesGrossPence: pence(row.fees_pounds),
        feesVatPence: pence(row.fees_vat_pounds),
        actualShippingCostPence: null, // no shipping column — uses your shipping rules
      })
    })
    setRows(parsedRows)
    setOrders(normalized)
    setInvalidRows(invalid)
    setStatus(
      `Found ${normalized.length} rows — review below, then confirm.` +
      (invalid.length ? ` ${invalid.length} row(s) can't be imported (missing order number, SKU, quantity, or a date that isn't DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD): spreadsheet row ${invalid.join(', ')}.` : '')
    )
  }

  async function handleImport() {
    if (!store) {
      setStatus('Please choose which store this file is from first.')
      return
    }
    if (orders.length === 0) {
      setStatus('No valid rows to import.')
      return
    }

    const result = await importOrdersForStore(store, orders, setStatus, { createUnknownSkus })
    setStatus(describeImportResult(result, store))
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>CSV / Excel Upload</h1>
      <p style={pageIntro}>
        For any store without its own import page (e.g. Shopify). Choose the store, pick your CSV or Excel (.xlsx) file, review the rows, then confirm.
      </p>

      <div style={cardStyle}>
        <StorePicker platformFilter={() => true} value={store} onChange={setStore} />
        <CreateProductsToggle checked={createUnknownSkus} onChange={setCreateUnknownSkus} />
        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '16px' }} />
        {status && <p style={{ color: invalidRows.length ? red : lime, fontSize: '14px', fontWeight: 600, margin: '16px 0 0' }}>{status}</p>}
      </div>

      {rows.length > 0 && (
        <div style={cardStyle}>
          <p style={cardTitle}>Preview ({rows.length} rows)</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {Object.keys(rows[0]).map((key) => (
                    <th key={key} style={{ ...thStyle, whiteSpace: 'nowrap' }}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={invalidRows.includes(i + 2) ? { opacity: 0.4 } : undefined}>
                    {Object.values(row).map((val, j) => (
                      <td key={j} style={{ ...tdStyle, fontSize: '13px' }}>{val}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={handleImport} style={{ ...primaryButton, marginTop: '18px' }}>
            Confirm import
          </button>
        </div>
      )}
    </div>
  )
}
