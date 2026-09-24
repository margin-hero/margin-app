'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'

export default function TikTokCatalogPage() {
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<{ skuId: string; sellerSku: string }[]>([])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setStatus('Reading file...')

    const reader = new FileReader()
    reader.onload = (event) => {
      const data = event.target?.result
      const workbook = XLSX.read(data, { type: 'binary' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

      // TikTok's template has a few header rows before the human-readable one.
      // Find the row that actually contains "SKU ID" and "Seller SKU" as labels.
      let headerRowIndex = -1
      let skuIdCol = -1
      let sellerSkuCol = -1

      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i]
        const idIdx = row.findIndex((cell) => String(cell).trim() === 'SKU ID')
        const skuIdx = row.findIndex((cell) => String(cell).trim() === 'Seller SKU')
        if (idIdx !== -1 && skuIdx !== -1) {
          headerRowIndex = i
          skuIdCol = idIdx
          sellerSkuCol = skuIdx
          break
        }
      }

      if (headerRowIndex === -1) {
        setStatus('Could not find "SKU ID" and "Seller SKU" columns in this file.')
        return
      }

      const mapping: { skuId: string; sellerSku: string }[] = []
      for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i]
        const skuId = row[skuIdCol]
        const sellerSku = row[sellerSkuCol]
        // TikTok's real SKU IDs are always purely numeric — this skips the
        // template's instructional rows ("Mandatory", "Uneditable", etc.)
        if (skuId && sellerSku && /^\d+$/.test(String(skuId).trim())) {
          mapping.push({ skuId: String(skuId).trim(), sellerSku: String(sellerSku).trim() })
        }
      }

      setPreview(mapping)
      ;(window as any).__tiktokCatalogMapping = mapping
      setStatus(`Found ${mapping.length} SKU mappings. Review below, then confirm.`)
    }
    reader.readAsBinaryString(file)
  }

  async function handleImport() {
    const mapping: { skuId: string; sellerSku: string }[] = (window as any).__tiktokCatalogMapping || []
    if (mapping.length === 0) {
      setStatus('No mapping data to import.')
      return
    }

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .eq('name', 'Test Store')
      .single()

    if (tenantError || !tenant) {
      setStatus(`Error looking up tenant: ${tenantError?.message || 'not found'}`)
      return
    }

    const rows = mapping.map((m) => ({
      tenant_id: tenant.id,
      sku_id: m.skuId,
      seller_sku: m.sellerSku,
    }))

    const { error } = await supabase
      .from('tiktok_sku_catalog')
      .upsert(rows, { onConflict: 'tenant_id,sku_id' })

    if (error) {
      setStatus(`Error saving catalog: ${error.message}`)
      return
    }

    setStatus(`Saved ${rows.length} SKU mappings. You can now import TikTok settlement reports.`)
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>TikTok SKU Catalog Mapping</h1>
      <p style={{ color: '#666' }}>Upload your TikTok product catalog export once, to teach the system which SKU ID matches which of your Seller SKUs. Re-upload only when new products launch.</p>
      <input type="file" accept=".xlsx" onChange={handleFile} style={{ marginTop: '1rem' }} />
      <p>{status}</p>

      {preview.length > 0 && (
        <>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '1rem', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                <th style={{ padding: '6px' }}>SKU ID</th>
                <th style={{ padding: '6px' }}>Seller SKU</th>
              </tr>
            </thead>
            <tbody>
              {preview.slice(0, 20).map((row) => (
                <tr key={row.skuId} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px' }}>{row.skuId}</td>
                  <td style={{ padding: '6px' }}>{row.sellerSku}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={handleImport} style={{ marginTop: '1rem', padding: '8px 16px' }}>
            Save Catalog Mapping
          </button>
        </>
      )}
    </div>
  )
}
