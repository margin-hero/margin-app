'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { pounds, ukDate } from '@/lib/format'
import { muted, red, thStyle, tdStyle, primaryButton, linkButton, statusColor, marginTier, MarginRanges } from '@/lib/theme'

export type OrderLine = {
  id: string
  date: string
  channel: string // platform, e.g. OnBuy
  store: string
  sku: string
  product: string
  qty: number
  salePence: number
  perUnitPence: number
  revenuePence: number
  productCostPence: number
  feesPence: number
  shippingPence: number
  otherCostPence: number
  netProfitPence: number
  marginPercent: number | null
}

// Order lines table with tick boxes to delete test orders. Deleting is permanent:
// re-uploading the same file brings the orders back.
export default function OrderLinesTable({ lines, ranges }: { lines: OrderLine[]; ranges: MarginRanges }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const allSelected = lines.length > 0 && selected.size === lines.length
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function deleteSelected() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!window.confirm(`Permanently delete ${ids.length} order line(s)? This can't be undone (re-upload the file to bring them back).`)) return
    setBusy(true)
    setStatus('Deleting...')
    // In batches, so a big selection doesn't make one request too long
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('order_line_items').delete().in('id', ids.slice(i, i + 200))
      if (error) {
        setStatus(`Error deleting: ${error.message}`)
        setBusy(false)
        router.refresh()
        return
      }
    }
    setSelected(new Set())
    setStatus(`Deleted ${ids.length} order line(s).`)
    setBusy(false)
    router.refresh()
  }

  const num: React.CSSProperties = { ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }
  const numHead: React.CSSProperties = { ...thStyle, textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <>
      <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 12px' }}>
        <span style={{ fontSize: '13px', color: muted }}>
          {lines.length.toLocaleString('en-GB')} order lines{selected.size > 0 ? ` · ${selected.size} selected` : ''}
        </span>
        {selected.size > 0 && (
          <>
            <button onClick={deleteSelected} disabled={busy} style={{ ...primaryButton, background: red, opacity: busy ? 0.6 : 1 }}>
              Delete selected
            </button>
            <button onClick={() => setSelected(new Set())} style={{ ...linkButton, color: muted }}>Clear selection</button>
          </>
        )}
        {status && <span style={{ fontSize: '13px', fontWeight: 600, color: statusColor(status) }}>{status}</span>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '1300px' }}>
          <thead>
            <tr>
              <th style={thStyle}>
                <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(lines.map((l) => l.id)))} aria-label="Select all" />
              </th>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Channel</th>
              <th style={thStyle}>Store</th>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>Product</th>
              <th style={numHead}>Qty</th>
              <th style={numHead}>Sale price</th>
              <th style={numHead}>Per unit</th>
              <th style={numHead}>Revenue</th>
              <th style={numHead}>Product cost</th>
              <th style={numHead}>Fees</th>
              <th style={numHead}>Shipping</th>
              <th style={numHead}>Other costs</th>
              <th style={numHead}>Net profit</th>
              <th style={numHead}>Net margin</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} style={selected.has(l.id) ? { background: 'rgba(255,255,255,0.04)' } : undefined}>
                <td style={tdStyle}>
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select order line ${l.id}`} />
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: muted }}>{ukDate(l.date)}</td>
                <td style={tdStyle}>{l.channel}</td>
                <td style={tdStyle}>{l.store}</td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{l.sku}</td>
                <td style={tdStyle}>{l.product}</td>
                <td style={num}>{l.qty}</td>
                <td style={num}>{pounds(l.salePence)}</td>
                <td style={num}>{pounds(l.perUnitPence)}</td>
                <td style={num}>{pounds(l.revenuePence)}</td>
                <td style={num}>{pounds(l.productCostPence)}</td>
                <td style={num}>{pounds(l.feesPence)}</td>
                <td style={num}>{pounds(l.shippingPence)}</td>
                <td style={num}>{pounds(l.otherCostPence)}</td>
                <td style={{ ...num, fontWeight: 700 }}>{pounds(l.netProfitPence)}</td>
                <td style={{ ...num, fontWeight: 800, color: marginTier(l.marginPercent, ranges).fg }}>{l.marginPercent === null ? '—' : `${l.marginPercent}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
