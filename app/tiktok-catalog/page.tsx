'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Store } from '@/lib/stores'
import StorePicker from '@/components/StorePicker'
import { muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, statusColor } from '@/lib/theme'

export default function TikTokCatalogPage() {
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<{ skuId: string; sellerSku: string }[]>([])
  const [store, setStore] = useState<Store | null>(null)

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

    if (!store) {
      setStatus('Please choose which TikTok store this catalog belongs to first.')
      return
    }

    const rows = mapping.map((m) => ({
      tenant_id: store.tenant_id,
      store_id: store.id,
      sku_id: m.skuId,
      seller_sku: m.sellerSku,
    }))

    const { error } = await supabase
      .from('tiktok_sku_catalog')
      .upsert(rows, { onConflict: 'store_id,sku_id' })

    if (error) {
      setStatus(`Error saving catalog: ${error.message}`)
      return
    }

    setStatus(`Saved ${rows.length} SKU mappings for ${store.name}. You can now import its TikTok settlement reports.`)
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>TikTok Catalog</h1>
      <p style={pageIntro}>Upload each TikTok shop's product catalog export once, to teach the system which SKU ID matches which of your Seller SKUs. Re-upload only when new products launch.</p>
      <div style={cardStyle}>
      <StorePicker platformFilter={(p) => p.name === 'TikTok'} value={store} onChange={setStore} />
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
                <th style={thStyle}>SKU ID</th>
                <th style={thStyle}>Seller SKU</th>
              </tr>
            </thead>
            <tbody>
              {preview.slice(0, 20).map((row) => (
                <tr key={row.skuId}>
                  <td style={tdStyle}>{row.skuId}</td>
                  <td style={tdStyle}>{row.sellerSku}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <button onClick={handleImport} style={{ ...primaryButton, marginTop: '18px' }}>
            Save Catalog Mapping
          </button>
        </div>
      )}
    </div>
  )
}
