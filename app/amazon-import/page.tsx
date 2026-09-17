'use client'

import { useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase'

type AmazonRow = {
  'transaction-type': string
  'order-id': string
  'order-item-code': string
  'amount-type': string
  'amount-description': string
  amount: string
  sku: string
  'quantity-purchased': string
  'posted-date': string
}

type GroupedOrder = {
  orderId: string
  orderItemCode: string
  sku: string
  qty: number
  orderDate: string
  principal: number
  tax: number
  fees: number
}

function parseAmazonDate(dateStr: string): string {
  const datePart = dateStr.split(' ')[0]
  const [day, month, year] = datePart.split('.')
  return `${year}-${month}-${day}`
}

export default function AmazonImportPage() {
  const [status, setStatus] = useState<string>('')
  const [preview, setPreview] = useState<GroupedOrder[]>([])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setStatus('Parsing file, this may take a moment for large files...')

    Papa.parse<AmazonRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        // Only handle standard sales for this first pass — skip Refund, SAFE-T, account-level noise
        const orderRows = results.data.filter((row) => row['transaction-type'] === 'Order')

        // Group by order-item-code (unique per line item within an order)
        const groups = new Map<string, AmazonRow[]>()
        for (const row of orderRows) {
          const key = row['order-item-code']
          if (!key) continue
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(row)
        }

        // Also collect real shipping label costs, keyed by order-id
        const shippingByOrderId = new Map<string, number>()
        for (const row of results.data) {
          if (
            row['transaction-type'] === 'other-transaction' &&
            row['amount-description'] === 'Shipping label purchase'
          ) {
            const orderId = row['order-id']
            const amt = Math.abs(parseFloat(row.amount))
            shippingByOrderId.set(orderId, (shippingByOrderId.get(orderId) || 0) + amt)
          }
        }

        const grouped: GroupedOrder[] = []
        for (const [orderItemCode, rows] of groups) {
          const first = rows[0]
          let principal = 0
          let tax = 0
          let fees = 0

          for (const row of rows) {
            const amt = parseFloat(row.amount)
            if (row['amount-type'] === 'ItemPrice' && row['amount-description'] === 'Principal') {
              principal += amt
            } else if (row['amount-type'] === 'ItemPrice' && row['amount-description'] === 'Tax') {
              tax += amt
            } else if (row['amount-type'] === 'ItemFees') {
              fees += Math.abs(amt)
            }
          }

          grouped.push({
            orderId: first['order-id'],
            orderItemCode,
            sku: first.sku,
            qty: parseInt(first['quantity-purchased']) || 1,
            orderDate: parseAmazonDate(first['posted-date']),
            principal,
            tax,
            fees,
          })
        }

        // Attach real shipping cost to preview data via a side map (not shown in table, used at import time)
        ;(window as any).__shippingByOrderId = shippingByOrderId

        setPreview(grouped.slice(0, 20)) // show first 20 for review
        ;(window as any).__fullGrouped = grouped
        setStatus(`Parsed ${grouped.length} order lines from ${orderRows.length} raw rows. Showing first 20 below — review, then confirm import.`)
      },
    })
  }

  async function handleImport() {
    const grouped: GroupedOrder[] = (window as any).__fullGrouped || []
    const shippingByOrderId: Map<string, number> = (window as any).__shippingByOrderId || new Map()

    if (grouped.length === 0) {
      setStatus('No parsed data to import.')
      return
    }

    setStatus('Looking up existing platform listings...')

    const { data: platform } = await supabase
      .from('platforms')
      .select('id')
      .eq('name', 'Amazon UK')
      .single()

    if (!platform) {
      setStatus('Error: Amazon UK platform not found.')
      return
    }

    const { data: listings, error: listingsError } = await supabase
      .from('platform_listings')
      .select('id, platform_sku, master_product_id')
      .eq('platform_id', platform.id)

    if (listingsError) {
      setStatus(`Error looking up listings: ${listingsError.message}`)
      return
    }

    const skuToListingId = new Map(listings.map((l) => [l.platform_sku, l.id]))

    // Find SKUs in this file that don't have a listing yet
    const uniqueSkus = Array.from(new Set(grouped.map((g) => g.sku)))
    const newSkus = uniqueSkus.filter((sku) => !skuToListingId.has(sku))

    if (newSkus.length > 0) {
      setStatus(`Creating ${newSkus.length} new products for unrecognised SKUs...`)

      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('id')
        .eq('name', 'Test Store')
        .single()

      if (tenantError || !tenant) {
        setStatus(`Error looking up tenant: ${tenantError?.message || 'not found'}`)
        return
      }

      const creationErrors: string[] = []

      for (const sku of newSkus) {
        const { data: newProduct, error: productError } = await supabase
          .from('master_products')
          .insert({ tenant_id: tenant.id, standard_sku: sku, name: sku })
          .select('id')
          .single()

        if (productError || !newProduct) {
          creationErrors.push(`${sku}: ${productError?.message || 'unknown error'}`)
          continue
        }

        const { data: newListing, error: listingError } = await supabase
          .from('platform_listings')
          .insert({
            master_product_id: newProduct.id,
            platform_id: platform.id,
            platform_sku: sku,
          })
          .select('id')
          .single()

        if (listingError || !newListing) {
          creationErrors.push(`${sku} (listing): ${listingError?.message || 'unknown error'}`)
          continue
        }

        skuToListingId.set(sku, newListing.id)
      }

      if (creationErrors.length > 0) {
        setStatus(`Errors creating ${creationErrors.length} products: ${creationErrors.slice(0, 3).join(' | ')}${creationErrors.length > 3 ? '...' : ''}`)
        return
      }
    }

    setStatus('Checking for already-imported orders...')

    const candidateRows = grouped
      .filter((g) => skuToListingId.has(g.sku))
      .map((g) => {
        const feesGrossPence = Math.round(g.fees * 100)
        const feesVatPence = Math.round(feesGrossPence - feesGrossPence / 1.2)
        return {
          platform_listing_id: skuToListingId.get(g.sku)!,
          external_id: g.orderItemCode,
          order_date: g.orderDate,
          qty: g.qty,
          sale_price_gross_pence: Math.round((g.principal + g.tax) * 100),
          sale_vat_pence: Math.round(g.tax * 100),
          fees_gross_pence: feesGrossPence,
          fees_vat_pence: feesVatPence,
          actual_shipping_cost_pence: shippingByOrderId.has(g.orderId)
            ? Math.round(shippingByOrderId.get(g.orderId)! * 100)
            : null,
        }
      })

    // Check existing in batches (Supabase .in() has practical limits, so chunk)
    const chunkSize = 500
    const existingKeys = new Set<string>()
    for (let i = 0; i < candidateRows.length; i += chunkSize) {
      const chunk = candidateRows.slice(i, i + chunkSize)
      const { data: existing } = await supabase
        .from('order_line_items')
        .select('platform_listing_id, external_id')
        .in('external_id', chunk.map((r) => r.external_id))

      existing?.forEach((e) => existingKeys.add(`${e.platform_listing_id}|${e.external_id}`))
    }

    const newRows = candidateRows.filter(
      (r) => !existingKeys.has(`${r.platform_listing_id}|${r.external_id}`)
    )

    setStatus(`Importing ${newRows.length} new order lines...`)

    let inserted = 0
    for (let i = 0; i < newRows.length; i += chunkSize) {
      const chunk = newRows.slice(i, i + chunkSize)
      const { error: insertError } = await supabase.from('order_line_items').insert(chunk)
      if (insertError) {
        setStatus(`Import error on batch starting at row ${i}: ${insertError.message}`)
        return
      }
      inserted += chunk.length
    }

    setStatus(
      `Done. Imported ${inserted} new order lines. Skipped ${candidateRows.length - newRows.length} already-imported. ` +
      `${grouped.length - candidateRows.length} rows had no matching SKU after product creation attempt.`
    )
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Amazon Settlement Report Import</h1>
      <p style={{ color: '#666' }}>First pass: standard sales only (Refunds and SAFE-T reimbursements are skipped for now).</p>
      <input type="file" accept=".csv" onChange={handleFile} style={{ marginTop: '1rem' }} />
      <p>{status}</p>

      {preview.length > 0 && (
        <>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '1rem', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                <th style={{ padding: '6px' }}>SKU</th>
                <th style={{ padding: '6px' }}>Order Date</th>
                <th style={{ padding: '6px' }}>Qty</th>
                <th style={{ padding: '6px' }}>Principal</th>
                <th style={{ padding: '6px' }}>Tax</th>
                <th style={{ padding: '6px' }}>Fees</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.orderItemCode} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px' }}>{row.sku}</td>
                  <td style={{ padding: '6px' }}>{row.orderDate}</td>
                  <td style={{ padding: '6px' }}>{row.qty}</td>
                  <td style={{ padding: '6px' }}>£{row.principal.toFixed(2)}</td>
                  <td style={{ padding: '6px' }}>£{row.tax.toFixed(2)}</td>
                  <td style={{ padding: '6px' }}>£{row.fees.toFixed(2)}</td>
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
