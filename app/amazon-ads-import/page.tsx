'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { pounds, ukDate } from '@/lib/format'
import { readSpreadsheet, toIsoDate } from '@/lib/readSpreadsheet'
import { Store } from '@/lib/stores'
import StorePicker from '@/components/StorePicker'
import { lime, muted, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, statusColor } from '@/lib/theme'

// Amazon Ads "advertised product" report from the new reporting suite, where you pick your
// own columns. What we need (and the names Amazon gives them):
const COL = {
  sku: 'Advertised product SKU',
  cost: 'Total cost',
  date: 'Date',
  year: 'Year',
  month: 'Month',
  day: 'Day of Month',
  sales: 'Sales',
  purchases: 'Purchases',
  units: 'Units sold',
  currency: 'Budget currency',
  marketplace: 'Advertised product marketplace',
  adProduct: 'Ad product',
}

// Amazon Ads UK adds 20% VAT to the spend in the report
const AD_VAT_RATE = 0.2

type AdDay = {
  sku: string
  date: string
  adType: string
  spendPence: number
  salesPence: number
  orders: number
  units: number
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// "2026-10-03", "03/10/2026" (UK), "Oct 3, 2026" or "3 Oct 2026" -> "2026-10-03"
function parseAdDate(value: string): string | null {
  const iso = toIsoDate(value)
  if (iso) return iso
  const named = value.trim().match(/^(?:([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})|(\d{1,2}) ([A-Za-z]{3})[a-z]*\.? (\d{4}))$/)
  if (!named) return null
  const [mon, d, y] = named[1] ? [named[1], named[2], named[3]] : [named[5], named[4], named[6]]
  const m = MONTHS.indexOf(mon.toLowerCase()) + 1
  return m ? toIsoDate(`${y}-${m}-${d}`) : null
}

// Amazon's "Ad product" column, if included: SPONSORED_PRODUCTS, SPONSORED_DISPLAY...
function adTypeOf(value: string | undefined): string {
  const v = (value || '').toLowerCase()
  if (v.includes('display')) return 'sponsored_display'
  if (v.includes('brand')) return 'sponsored_brands'
  return 'sponsored_products'
}

const toPence = (value: string | undefined) => Math.round((parseFloat((value || '').replace(/[£,]/g, '')) || 0) * 100)

export default function AmazonAdsImportPage() {
  const [store, setStore] = useState<Store | null>(null) // fulfilled by you
  const [fbaStore, setFbaStore] = useState<Store | null>(null) // fulfilled by Amazon
  const [status, setStatus] = useState('')
  const [days, setDays] = useState<AdDay[]>([])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setDays([])
    setStatus('Reading file...')

    let rows: Record<string, string>[]
    try {
      rows = await readSpreadsheet(file, [COL.date])
    } catch (err) {
      setStatus(`Error reading file: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    if (rows.length === 0) {
      setStatus('Error: the file has no rows.')
      return
    }

    const columns = Object.keys(rows[0])
    const has = (c: string) => columns.includes(c)
    const hasDate = has(COL.date) || (has(COL.month) && has(COL.day))
    const needed = [COL.sku, COL.cost].filter((c) => !has(c))
    if (needed.length || !hasDate) {
      setStatus(
        `Error: this file is missing ${[...needed, ...(hasDate ? [] : [`"${COL.date}" (or "${COL.month}" and "${COL.day}")`])].join(', ')}. ` +
        'See "Which columns to pick" below for the report to download.'
      )
      return
    }

    // One marketplace and one currency per file, so spend can't land in the wrong store
    const marketplaces = has(COL.marketplace) ? Array.from(new Set(rows.map((r) => r[COL.marketplace]).filter(Boolean))) : []
    if (marketplaces.length > 1) {
      setStatus(`Error: this file covers ${marketplaces.length} marketplaces (${marketplaces.join(', ')}). Download one report per marketplace (filter by marketplace in Amazon Ads) and upload them to the matching stores.`)
      return
    }
    const otherCurrencies = has(COL.currency) ? Array.from(new Set(rows.map((r) => r[COL.currency]).filter((c) => c && c !== 'GBP'))) : []
    if (otherCurrencies.length) {
      setStatus(`Error: this file has spend in ${otherCurrencies.join(', ')}. Only GBP is supported so far.`)
      return
    }

    // Without a year in the file, each day is taken as the most recent one that isn't in the future
    const today = new Date().toISOString().slice(0, 10)
    const guessYear = !has(COL.date) && !has(COL.year)
    const dateOf = (r: Record<string, string>): string | null => {
      if (has(COL.date)) return parseAdDate(r[COL.date])
      const m = parseInt(r[COL.month])
      const d = parseInt(r[COL.day])
      if (!m || !d) return null
      const ymd = (y: number) => toIsoDate(`${y}-${m}-${d}`)
      if (has(COL.year)) return ymd(parseInt(r[COL.year]))
      const thisYear = parseInt(today.slice(0, 4))
      const candidate = ymd(thisYear)
      return candidate && candidate <= today ? candidate : ymd(thisYear - 1)
    }

    // Add up per SKU per day (the file may be split further, e.g. by campaign)
    const byKey = new Map<string, AdDay>()
    let badDates = 0
    let noSku = 0
    for (const r of rows) {
      const spendPence = toPence(r[COL.cost])
      const salesPence = toPence(r[COL.sales])
      if (spendPence === 0 && salesPence === 0) continue // days with no spend and no ad sales
      const sku = (r[COL.sku] || '').trim()
      if (!sku) {
        noSku++
        continue
      }
      const date = dateOf(r)
      if (!date) {
        badDates++
        continue
      }
      const adType = adTypeOf(r[COL.adProduct])
      const key = `${sku}|${date}|${adType}`
      const day = byKey.get(key) || { sku, date, adType, spendPence: 0, salesPence: 0, orders: 0, units: 0 }
      day.spendPence += spendPence
      day.salesPence += salesPence
      day.orders += parseInt(r[COL.purchases]) || 0
      day.units += parseInt(r[COL.units]) || 0
      byKey.set(key, day)
    }
    if (badDates) {
      setStatus(`Error: ${badDates} row(s) have a date that couldn't be read. Expected a date like 2026-10-03 or 03/10/2026.`)
      return
    }

    const parsed = Array.from(byKey.values()).sort((a, b) => a.date.localeCompare(b.date) || a.sku.localeCompare(b.sku))
    if (parsed.length === 0) {
      setStatus('Warning: no ad spend in this file (every row is £0).')
      return
    }
    const dates = parsed.map((d) => d.date)
    const spend = parsed.reduce((s, d) => s + d.spendPence, 0)
    setDays(parsed)
    setStatus(
      `Found ${pounds(spend)} of ad spend (ex. VAT) on ${new Set(parsed.map((d) => d.sku)).size} SKU(s), ${ukDate(dates[0])} to ${ukDate(dates[dates.length - 1])}.` +
      (guessYear ? ` Warning: the file has no year, so dates are taken as the last 12 months up to today. Add the "${COL.date}" column to be sure.` : '') +
      (noSku ? ` ${noSku} row(s) with spend but no SKU are skipped.` : '') +
      ' Review the preview below, then confirm import.'
    )
  }

  async function handleImport() {
    const targets = [store, fbaStore].filter((s): s is Store => !!s)
    if (targets.length === 0) {
      setStatus('Please choose your Amazon store first.')
      return
    }
    setStatus('Matching SKUs to your store SKUs...')

    const { data: listings, error } = await fetchAll((from, to) =>
      supabase
        .from('platform_listings')
        .select('id, platform_sku, store_id')
        .in('store_id', targets.map((t) => t.id))
        .order('id')
        .range(from, to)
    )
    if (error) {
      setStatus(`Error loading store SKUs: ${error.message}`)
      return
    }
    // A SKU found in both stores goes to the FBA store if it looks like an FBA SKU
    const listingBySku = new Map<string, { id: string; store_id: string }>()
    for (const l of listings as { id: string; platform_sku: string; store_id: string }[]) {
      const existing = listingBySku.get(l.platform_sku)
      const isFbaStore = l.store_id === fbaStore?.id
      if (!existing || (isFbaStore && /FBA$/i.test(l.platform_sku))) listingBySku.set(l.platform_sku, l)
    }
    // Amazon's report sometimes shows spaces in a SKU as "+" (e.g. "1+Hammertop+18mm+Floor")
    const find = (sku: string) => listingBySku.get(sku) ?? listingBySku.get(sku.replace(/\+/g, ' '))

    const rows: Record<string, unknown>[] = []
    const unmatched = new Map<string, number>() // SKU -> spend held back
    for (const d of days) {
      const listing = find(d.sku)
      if (!listing) {
        unmatched.set(d.sku, (unmatched.get(d.sku) || 0) + d.spendPence)
        continue
      }
      rows.push({
        store_id: listing.store_id,
        platform_listing_id: listing.id,
        spend_date: d.date,
        ad_type: d.adType,
        spend_pence: d.spendPence,
        vat_rate: AD_VAT_RATE,
        attributed_sales_pence: d.salesPence,
        attributed_orders: d.orders,
        attributed_units: d.units,
        source: 'amazon_ads_report',
        imported_at: new Date().toISOString(),
      })
    }

    // Re-uploading a day replaces it (Amazon keeps updating attributed sales for a while)
    for (let i = 0; i < rows.length; i += 500) {
      setStatus(`Saving ${Math.min(i + 500, rows.length)} of ${rows.length} SKU-days...`)
      const { error: saveError } = await supabase
        .from('ad_spend')
        .upsert(rows.slice(i, i + 500), { onConflict: 'platform_listing_id,ad_type,spend_date' })
      if (saveError) {
        setStatus(`Error saving ad spend: ${saveError.message}`)
        return
      }
    }

    const saved = rows.reduce((s, r) => s + (r.spend_pence as number), 0)
    const heldBack = Array.from(unmatched.values()).reduce((s, p) => s + p, 0)
    setStatus(
      `Imported ${pounds(saved)} of ad spend across ${rows.length} SKU-days.` +
      (unmatched.size
        ? ` Held back ${pounds(heldBack)} on ${unmatched.size} SKU(s) not set up in ${targets.length > 1 ? 'these stores' : 'this store'}: ${Array.from(unmatched.keys()).slice(0, 10).join(', ')}${unmatched.size > 10 ? '...' : ''}. Add them on Store SKUs (or import their orders first), then upload the file again.`
        : '')
    )
  }

  const spec = (name: string, note: string, required = false) => (
    <tr>
      <td style={{ ...tdStyle, fontWeight: 700, color: required ? lime : text }}>{name}</td>
      <td style={{ ...tdStyle, color: muted }}>{note}</td>
    </tr>
  )

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Import</p>
      <h1 style={pageTitle}>Amazon Ads Import</h1>
      <p style={pageIntro}>
        Upload your Sponsored Products spend per SKU per day. It&apos;s matched to your store SKUs (FBA SKUs go to your FBA store),
        then taken off net profit on the Margins, Channel Overview and SKU Detail dashboards (&quot;after ads&quot;).
        Re-uploading the same days replaces them, so overlapping reports are safe.
      </p>

      <div style={cardStyle}>
        <StorePicker platformFilter={(p) => p.name.startsWith('Amazon')} storeFilter={(st) => !st.fulfilled_by_channel} label="Store (you ship)" value={store} onChange={setStore} />
        <div style={{ marginTop: '10px' }}>
          <StorePicker platformFilter={(p) => p.name.startsWith('Amazon')} storeFilter={(st) => st.fulfilled_by_channel} label="FBA store (Amazon ships)" optional value={fbaStore} onChange={setFbaStore} />
        </div>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} style={{ color: muted, fontSize: '14px', marginTop: '16px', display: 'block' }} />
        {status && <p style={{ color: statusColor(status), fontSize: '14px', fontWeight: 600, margin: '16px 0 0', lineHeight: 1.5 }}>{status}</p>}
      </div>

      {days.length > 0 && (
        <div style={cardStyle}>
          <p style={cardTitle}>Preview (first 20 SKU-days)</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Spend (ex. VAT)</th>
                  <th style={thStyle}>Ad sales</th>
                  <th style={thStyle}>Units</th>
                </tr>
              </thead>
              <tbody>
                {days.slice(0, 20).map((d) => (
                  <tr key={`${d.sku}|${d.date}|${d.adType}`}>
                    <td style={tdStyle}>{d.sku}</td>
                    <td style={tdStyle}>{ukDate(d.date)}</td>
                    <td style={tdStyle}>{pounds(d.spendPence)}</td>
                    <td style={tdStyle}>{pounds(d.salesPence)}</td>
                    <td style={tdStyle}>{d.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={handleImport} style={{ ...primaryButton, marginTop: '18px' }}>
            Confirm import (every row in the file, not just the ones shown)
          </button>
        </div>
      )}

      <div style={cardStyle}>
        <p style={cardTitle}>Which columns to pick</p>
        <p style={{ color: muted, fontSize: '14px', lineHeight: 1.6, margin: '0 0 12px' }}>
          In Amazon Ads, open Reports and create a new report on <strong style={{ color: text }}>advertised products</strong> (Sponsored Products).
          Choose one marketplace, a <strong style={{ color: text }}>daily</strong> time unit, and download it as CSV or Excel.
          Pick these columns (the ones in <span style={{ color: lime }}>lime</span> are required; any others are ignored):
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {spec(COL.sku, 'Your seller SKU: matched to your store SKUs.', true)}
              {spec(COL.cost, 'The ad spend, ex. VAT. Amazon adds 20% VAT on top: it counts as a cost for stores that aren\'t VAT registered.', true)}
              {spec(COL.date, `The day. Or "${COL.year}", "${COL.month}" and "${COL.day}". Month + day on their own work too, taken as the last 12 months.`, true)}
              {spec(COL.sales, 'Sales Amazon credits to the ads: used for ACOS. Recommended.')}
              {spec(COL.units, 'Units sold through the ads.')}
              {spec(COL.purchases, 'Orders through the ads.')}
              {spec(COL.marketplace, 'Checked: one marketplace per file.')}
              {spec(COL.currency, 'Checked: GBP only for now.')}
            </tbody>
          </table>
        </div>
        <p style={{ color: muted, fontSize: '13px', lineHeight: 1.6, margin: '12px 0 0' }}>
          Sponsored Brands and Sponsored Display campaigns that aren&apos;t tied to one SKU aren&apos;t imported yet. SKUs that aren&apos;t set up
          in your store are held back: add them on <Link href="/mappings" style={{ color: lime }}>Store SKUs</Link> and upload again.
        </p>
      </div>
    </div>
  )
}
