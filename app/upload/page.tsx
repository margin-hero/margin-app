'use client'

import { useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'

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

export default function UploadPage() {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [status, setStatus] = useState<string>('')

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setRows(results.data)
        setStatus(`Parsed ${results.data.length} rows — review below, then confirm.`)
      },
    })
  }

  async function handleImport() {
    setStatus('Importing...')

    // Look up platform_listing_id for each row based on platform_sku
    const { data: listings, error: listingsError } = await supabase
      .from('platform_listings')
      .select('id, platform_sku')

    if (listingsError) {
      setStatus(`Error looking up listings: ${listingsError.message}`)
      return
    }

    const skuToListingId = new Map(listings.map((l) => [l.platform_sku, l.id]))

    const candidateRows = []
    const skippedSkus: string[] = []

    for (const row of rows) {
      const listingId = skuToListingId.get(row.platform_sku)
      if (!listingId) {
        skippedSkus.push(row.platform_sku)
        continue
      }
      candidateRows.push({
        platform_listing_id: listingId,
        external_id: row.external_id,
        order_date: row.order_date,
        qty: parseInt(row.qty),
        sale_price_gross_pence: Math.round(parseFloat(row.sale_price_pounds) * 100),
        sale_vat_pence: Math.round(parseFloat(row.sale_vat_pounds) * 100),
        fees_gross_pence: Math.round(parseFloat(row.fees_pounds) * 100),
        fees_vat_pence: Math.round(parseFloat(row.fees_vat_pounds) * 100),
      })
    }

    // Check which of these (platform_listing_id, external_id) pairs already exist
    const { data: existing, error: existingError } = await supabase
      .from('order_line_items')
      .select('platform_listing_id, external_id')
      .in('platform_listing_id', candidateRows.map((r) => r.platform_listing_id))

    if (existingError) {
      setStatus(`Error checking for duplicates: ${existingError.message}`)
      return
    }

    const existingKeys = new Set(existing.map((e) => `${e.platform_listing_id}|${e.external_id}`))

    const newRows = candidateRows.filter(
      (r) => !existingKeys.has(`${r.platform_listing_id}|${r.external_id}`)
    )
    const duplicateExternalIds = candidateRows
      .filter((r) => existingKeys.has(`${r.platform_listing_id}|${r.external_id}`))
      .map((r) => r.external_id)

    let insertedCount = 0
    if (newRows.length > 0) {
      const { error: insertError } = await supabase
        .from('order_line_items')
        .insert(newRows)

      if (insertError) {
        setStatus(`Import error: ${insertError.message}`)
        return
      }
      insertedCount = newRows.length
    }

    const messages = [`Imported ${insertedCount} new order(s).`]
    if (duplicateExternalIds.length) {
      messages.push(`Skipped ${duplicateExternalIds.length} already-imported order(s): ${duplicateExternalIds.join(', ')}`)
    }
    if (skippedSkus.length) {
      messages.push(`Skipped unknown SKUs: ${skippedSkus.join(', ')}`)
    }
    setStatus(messages.join(' '))
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Upload Orders CSV</h1>
      <input type="file" accept=".csv" onChange={handleFile} style={{ marginTop: '1rem' }} />
      <p>{status}</p>

      {rows.length > 0 && (
        <>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '1rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                {Object.keys(rows[0]).map((key) => (
                  <th key={key} style={{ padding: '6px' }}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                  {Object.values(row).map((val, j) => (
                    <td key={j} style={{ padding: '6px' }}>{val}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={handleImport} style={{ marginTop: '1rem', padding: '8px 16px' }}>
            Confirm Import
          </button>
        </>
      )}
    </div>
  )
}
