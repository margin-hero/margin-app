'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Store } from '@/lib/stores'
import StorePicker from '@/components/StorePicker'
import { muted, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, linkButton, statusColor } from '@/lib/theme'

type CatalogRow = { skuId: string; sellerSku: string }

// Bulk-fills TikTok SKU IDs from TikTok's product catalog export (SKU ID + Seller SKU).
// Lives on the Mappings page; saves into channel_sku_ids for the chosen TikTok store.
export default function TikTokCatalogUpload({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [store, setStore] = useState<Store | null>(null)
  const [rows, setRows] = useState<CatalogRow[]>([])
  const [status, setStatus] = useState('')

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('Reading file...')

    const reader = new FileReader()
    reader.onload = (event) => {
      const workbook = XLSX.read(event.target?.result, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 })

      // TikTok's template has a few header rows before the human-readable one.
      // Find the row that actually contains "SKU ID" and "Seller SKU" as labels.
      let headerRow = -1
      let idCol = -1
      let skuCol = -1
      for (let i = 0; i < Math.min(grid.length, 10); i++) {
        const idIdx = (grid[i] || []).findIndex((cell) => String(cell).trim() === 'SKU ID')
        const skuIdx = (grid[i] || []).findIndex((cell) => String(cell).trim() === 'Seller SKU')
        if (idIdx !== -1 && skuIdx !== -1) {
          headerRow = i
          idCol = idIdx
          skuCol = skuIdx
          break
        }
      }
      if (headerRow === -1) {
        setStatus('Could not find "SKU ID" and "Seller SKU" columns in this file.')
        return
      }

      const found: CatalogRow[] = []
      for (let i = headerRow + 1; i < grid.length; i++) {
        const skuId = String(grid[i]?.[idCol] ?? '').trim()
        const sellerSku = String(grid[i]?.[skuCol] ?? '').trim()
        // Real SKU IDs are purely numeric; this skips the template's instruction rows
        if (skuId && sellerSku && /^\d+$/.test(skuId)) found.push({ skuId, sellerSku })
      }
      setRows(found)
      setStatus(`Found ${found.length} SKU IDs. Check the preview, then save.`)
    }
    reader.readAsArrayBuffer(file)
  }

  async function save() {
    if (!store) {
      setStatus('Please choose which TikTok store this catalog belongs to.')
      return
    }
    if (rows.length === 0) {
      setStatus('No SKU IDs to save. Choose a file first.')
      return
    }
    const { error } = await supabase.from('channel_sku_ids').upsert(
      rows.map((r) => ({ tenant_id: store.tenant_id, store_id: store.id, sku_id: r.skuId, seller_sku: r.sellerSku })),
      { onConflict: 'store_id,sku_id' }
    )
    if (error) {
      setStatus(`Error saving: ${error.message}`)
      return
    }
    setStatus(`Saved ${rows.length} TikTok SKU IDs for ${store.name}.`)
    setRows([])
    onSaved()
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <p style={{ ...cardTitle, margin: 0 }}>TikTok catalog upload</p>
        <button onClick={() => setOpen(!open)} style={linkButton}>{open ? 'Close' : 'Open'}</button>
      </div>
      <p style={{ color: muted, fontSize: '13px', margin: '8px 0 0', lineHeight: 1.5 }}>
        TikTok reports identify products by a numeric SKU ID. Upload a TikTok shop&apos;s product catalog export (Seller Centre → Products → export)
        to fill in the SKU ID for every Seller SKU at once. Re-upload when you launch new products.
      </p>
      {open && (
        <div style={{ marginTop: '16px' }}>
          <StorePicker platformFilter={(p) => p.name === 'TikTok'} value={store} onChange={setStore} />
          <input type="file" accept=".xlsx" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '14px', display: 'block' }} />
          {status && <p style={{ color: statusColor(status), fontSize: '14px', fontWeight: 600, margin: '14px 0 0' }}>{status}</p>}
          {rows.length > 0 && (
            <>
              <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '14px' }}>
                <thead><tr><th style={thStyle}>TikTok SKU ID</th><th style={thStyle}>Seller SKU</th></tr></thead>
                <tbody>
                  {rows.slice(0, 20).map((r) => (
                    <tr key={r.skuId}><td style={tdStyle}>{r.skuId}</td><td style={tdStyle}>{r.sellerSku}</td></tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 20 && <p style={{ color: muted, fontSize: '13px' }}>...and {rows.length - 20} more.</p>}
              <button onClick={save} style={{ ...primaryButton, marginTop: '14px' }}>Save {rows.length} SKU IDs</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
