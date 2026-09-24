'use client'

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { importOrdersForPlatform, NormalizedOrder } from '@/lib/importEngine'

function parseMiraklDate(dateStr: string): string {
  // "09/07/2026 - 21:45:52" -> "2026-07-09"
  const datePart = String(dateStr).split(' - ')[0]
  const [day, month, year] = datePart.split('/')
  return `${year}-${month}-${day}`
}

export default function MiraklImportPage() {
  const [platforms, setPlatforms] = useState<{ id: string; name: string }[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState('')
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<NormalizedOrder[]>([])
  const [allOrders, setAllOrders] = useState<NormalizedOrder[]>([])
  const [skippedRefunds, setSkippedRefunds] = useState(0)

  useEffect(() => {
    async function loadPlatforms() {
      const { data } = await supabase
        .from('platforms')
        .select('id, name')
        .eq('integration_type', 'mirakl')
        .order('name')
      setPlatforms(data || [])
    }
    loadPlatforms()
  }, [])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!selectedPlatform) {
      setStatus('Please select which retailer this export is from first.')
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
      setStatus(`Parsed ${normalized.length} order lines. Skipped ${refundRows.length} refund-related rows (handled later). Review below, then confirm.`)
    }
    reader.readAsBinaryString(file)
  }

  async function handleImport() {
    if (allOrders.length === 0) {
      setStatus('No parsed data to import.')
      return
    }
    const result = await importOrdersForPlatform(selectedPlatform, allOrders, setStatus)

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
      <h1>Mirakl Marketplace Import</h1>
      <p style={{ color: '#666' }}>Used for B&Q, The Range, Debenhams, and Tesco — same underlying report format, different retailer.</p>

      <div style={{ marginTop: '1rem' }}>
        <label style={{ marginRight: '8px' }}>Retailer:</label>
        <select value={selectedPlatform} onChange={(e) => setSelectedPlatform(e.target.value)} style={{ padding: '6px' }}>
          <option value="">Select...</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.name}>{p.name}</option>
          ))}
        </select>
      </div>

      <input type="file" accept=".xlsx,.csv" onChange={handleFile} style={{ marginTop: '1rem' }} />
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
                <th style={{ padding: '6px' }}>Shipping Revenue</th>
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
                  <td style={{ padding: '6px' }}>£{((row.shippingRevenueGrossPence || 0) / 100).toFixed(2)}</td>
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
