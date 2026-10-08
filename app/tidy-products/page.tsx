'use client'

import { useState } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { fetchAll } from '@/lib/fetchAll'
import { readSpreadsheet } from '@/lib/readSpreadsheet'
import { loadStores, Store, storeLabel } from '@/lib/stores'
import { skuGroupKey, suggestProductSku } from '@/lib/skuGroups'
import { ImportSummaryData } from '@/lib/importEngine'
import ImportSummary from '@/components/ImportSummary'
import { muted, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, primaryButton, statusColor } from '@/lib/theme'

// Tidy products: group store SKUs under the right products, in bulk, with a spreadsheet.
// A product = the thing you sell (your SKU, its costs and shipping). A store SKU = what one
// channel calls it. Sales belong to the store SKU, so moving a store SKU to another product
// moves its sales too: nothing is re-imported.
//
// Download: one row per store SKU, with its product now and a suggested product SKU
// (lib/skuGroups.ts). Fill in product_sku (and product_name), upload, check, apply.

const COLUMNS = ['store', 'store_sku', 'current_product_sku', 'current_product_name', 'suggested_product_sku', 'product_sku', 'product_name', 'listing_id']

type Listing = { id: string; store_id: string; platform_sku: string; master_product_id: string }
type Product = { id: string; standard_sku: string; name: string; vat_rate: number | null }

type Plan = {
  moves: { listing: Listing; storeName: string; fromSku: string; toSku: string }[]
  renames: { product: Product; toSku: string; toName: string }[] // a whole product taking a new SKU (keeps its costs)
  creates: { sku: string; name: string; vatRate: number | null }[]
  nameChanges: { product: Product; toName: string }[]
  deletes: Product[] // left with no store SKUs and no costs
  keptWithCosts: Product[] // left with no store SKUs but has costs: not deleted
  // where each target SKU's listings go: an existing product id, or the SKU of a new / renamed one
  targetOf: Map<string, { productId?: string; newSku?: string }>
  problems: string[]
  unchanged: number
}

// Everything the page needs, loaded fresh for each download / upload
async function loadData() {
  const [stores, listings, products, costs, rules, profiles] = await Promise.all([
    loadStores(supabase),
    fetchAll<Listing>((from, to) => supabase.from('platform_listings').select('id, store_id, platform_sku, master_product_id').order('id').range(from, to)),
    fetchAll<Product>((from, to) => supabase.from('master_products').select('id, standard_sku, name, vat_rate').order('id').range(from, to)),
    fetchAll<{ id: string; master_product_id: string }>((from, to) => supabase.from('cogs_components').select('id, master_product_id').order('id').range(from, to)),
    fetchAll<{ id: string; master_product_id: string }>((from, to) => supabase.from('shipping_rules').select('id, master_product_id').order('id').range(from, to)),
    fetchAll<{ id: string; master_product_id: string }>((from, to) => supabase.from('product_shipping_profiles').select('id, master_product_id').order('id').range(from, to)),
  ])
  const error = listings.error || products.error || costs.error || rules.error || profiles.error
  if (error) throw new Error(error.message)
  // Products with anything set up on them, which must never be deleted automatically
  const hasSetup = new Set([...costs.data, ...rules.data, ...profiles.data].map((r) => r.master_product_id))
  return { stores, listings: listings.data, products: products.data, hasSetup }
}

export default function TidyProductsPage() {
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [result, setResult] = useState<ImportSummaryData | null>(null)

  async function download() {
    setBusy(true)
    setStatus('Preparing your spreadsheet...')
    try {
      const { stores, listings, products, hasSetup } = await loadData()
      const storeOf = new Map(stores.map((s) => [s.id, s]))
      const productOf = new Map(products.map((p) => [p.id, p]))

      // Suggestions: store SKUs that look like the same product share a group
      const groups = new Map<string, Listing[]>()
      for (const l of listings) {
        const key = skuGroupKey(l.platform_sku)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(l)
      }
      const suggestionOf = new Map<string, string>()
      for (const members of groups.values()) {
        const suggestion = suggestProductSku(members.map((m) => ({
          productSku: productOf.get(m.master_product_id)?.standard_sku ?? m.platform_sku,
          productHasCosts: hasSetup.has(m.master_product_id),
        })))
        members.forEach((m) => suggestionOf.set(m.id, suggestion))
      }

      // Rows sorted so each suggested group sits together
      const rows = listings
        .map((l) => {
          const p = productOf.get(l.master_product_id)
          return [storeLabel(storeOf.get(l.store_id)), l.platform_sku, p?.standard_sku ?? '', p?.name ?? '', suggestionOf.get(l.id) ?? '', p?.standard_sku ?? '', p?.name ?? '', l.id]
        })
        .sort((a, b) => a[4].localeCompare(b[4]) || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))

      // Every cell as text, so Excel keeps SKUs like 00123 or 1-2 exactly as they are
      const sheet = XLSX.utils.aoa_to_sheet([COLUMNS, ...rows].map((r) => r.map((v) => ({ v, t: 's' }))))
      sheet['!cols'] = [18, 26, 22, 30, 22, 22, 30, 38].map((wch) => ({ wch }))
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book, sheet, 'Store SKUs')
      XLSX.writeFile(book, 'margin-hero-store-skus.xlsx')
      const suggested = rows.filter((r) => r[4] !== r[2]).length
      setStatus(`Downloaded ${listings.length.toLocaleString('en-GB')} store SKUs. ${suggested.toLocaleString('en-GB')} have a suggested product SKU different from their product now.`)
    } catch (err) {
      setStatus(`Error preparing the spreadsheet: ${err instanceof Error ? err.message : String(err)}`)
    }
    setBusy(false)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so the same file can be chosen again after editing it
    if (!file) return
    setPlan(null)
    setResult(null)
    setBusy(true)
    setStatus('Reading the spreadsheet and checking it against your products...')
    try {
      const rows = await readSpreadsheet(file)
      const missing = ['store', 'store_sku', 'product_sku'].filter((c) => rows.length === 0 || !(c in rows[0]))
      if (missing.length) throw new Error(`the file is missing these columns: ${missing.join(', ')}. Download the spreadsheet above and fill that in`)
      setPlan(buildPlan(rows, await loadData()))
      setStatus('')
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}.`)
    }
    setBusy(false)
  }

  async function apply() {
    if (!plan || busy) return
    setBusy(true)
    const problems: string[] = []
    const step = (message: string) => setStatus(message)
    try {
      // 1. Whole products taking a new SKU (they keep their costs and shipping)
      step('Renaming products...')
      for (const r of plan.renames) {
        const { error } = await supabase.from('master_products').update({ standard_sku: r.toSku, name: r.toName }).eq('id', r.product.id)
        if (error) throw new Error(`renaming ${r.product.standard_sku}: ${error.message}`)
      }
      // 2. New products
      step('Creating new products...')
      const newIdOf = new Map<string, string>()
      for (let i = 0; i < plan.creates.length; i += 200) {
        const chunk = plan.creates.slice(i, i + 200)
        const { data, error } = await supabase
          .from('master_products')
          .insert(chunk.map((c) => ({ standard_sku: c.sku, name: c.name, ...(c.vatRate === null ? {} : { vat_rate: c.vatRate }) })))
          .select('id, standard_sku')
        if (error) throw new Error(`creating products: ${error.message}`)
        data?.forEach((p) => newIdOf.set(p.standard_sku, p.id))
      }
      const renamedIdOf = new Map(plan.renames.map((r) => [r.toSku, r.product.id]))
      // 3. Move store SKUs (and with them their sales) to their product
      const byProduct = new Map<string, string[]>()
      for (const m of plan.moves) {
        const target = plan.targetOf.get(m.toSku)!
        const productId = target.productId ?? newIdOf.get(target.newSku!) ?? renamedIdOf.get(target.newSku!)
        if (!productId) {
          problems.push(`${m.storeName} ${m.listing.platform_sku}: its new product ${m.toSku} wasn't found, so it wasn't moved`)
          continue
        }
        if (!byProduct.has(productId)) byProduct.set(productId, [])
        byProduct.get(productId)!.push(m.listing.id)
      }
      let moved = 0
      for (const [productId, ids] of byProduct) {
        for (let i = 0; i < ids.length; i += 200) {
          step(`Moving store SKUs (${moved.toLocaleString('en-GB')} of ${plan.moves.length.toLocaleString('en-GB')})...`)
          const { error } = await supabase.from('platform_listings').update({ master_product_id: productId }).in('id', ids.slice(i, i + 200))
          if (error) throw new Error(`moving store SKUs: ${error.message}`)
          moved += Math.min(200, ids.length - i)
        }
      }
      // 4. Product names
      step('Updating product names...')
      for (const n of plan.nameChanges) {
        const { error } = await supabase.from('master_products').update({ name: n.toName }).eq('id', n.product.id)
        if (error) problems.push(`renaming ${n.product.standard_sku}: ${error.message}`)
      }
      // 5. Products now empty (no store SKUs, nothing set up): checked again first, then deleted
      step('Removing empty products...')
      let deleted = 0
      const toDelete = plan.deletes.map((p) => p.id)
      for (let i = 0; i < toDelete.length; i += 200) {
        const ids = toDelete.slice(i, i + 200)
        const { data: stillUsed } = await supabase.from('platform_listings').select('master_product_id').in('master_product_id', ids)
        const used = new Set((stillUsed ?? []).map((r) => r.master_product_id))
        const empty = ids.filter((id) => !used.has(id))
        if (empty.length === 0) continue
        const { data, error } = await supabase.from('master_products').delete().in('id', empty).select('id')
        if (error) problems.push(`removing empty products: ${error.message}`)
        deleted += data?.length ?? 0
      }

      setResult({
        headline: `Done: ${moved.toLocaleString('en-GB')} store SKUs moved`,
        tone: problems.length ? 'warn' : 'ok',
        sections: [
          {
            title: 'Changed',
            items: [
              moved ? `${moved.toLocaleString('en-GB')} store SKUs (and their sales) moved to their product` : '',
              plan.renames.length ? `${plan.renames.length.toLocaleString('en-GB')} products given their new SKU (costs and shipping kept)` : '',
              plan.creates.length ? `${plan.creates.length.toLocaleString('en-GB')} new products created: add their costs on Products` : '',
              plan.nameChanges.length ? `${plan.nameChanges.length.toLocaleString('en-GB')} product names updated` : '',
              deleted ? `${deleted.toLocaleString('en-GB')} empty products removed` : '',
            ].filter(Boolean),
          },
          ...(plan.keptWithCosts.length ? [{ title: 'Left for you to check', tone: 'warn' as const, items: [keptMessage(plan.keptWithCosts)] }] : []),
          ...(problems.length ? [{ title: 'Problems', tone: 'warn' as const, items: problems.slice(0, 20) }] : []),
        ].filter((s) => s.items.length > 0),
      })
      setPlan(null)
      setStatus('')
    } catch (err) {
      setStatus(`Error: stopped while ${err instanceof Error ? err.message : String(err)}. Download the spreadsheet again to see where things are now, then upload it again: changes already made are simply skipped.`)
    }
    setBusy(false)
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage · Products</p>
      <h1 style={pageTitle}>Tidy Products</h1>
      <p style={pageIntro}>
        A <strong style={{ color: text }}>product</strong> is the thing you sell: your own SKU (e.g. LL-1), with its costs and shipping.
        A <strong style={{ color: text }}>store SKU</strong> is what one channel calls it, and one product can have many: LL-1 on Amazon,
        LL-1-FBA in your FBA store, a different code on eBay. If an import created a product for every store SKU, use this page to group
        them under the right products. Sales go with their store SKU, so nothing needs importing again.
      </p>

      <div style={cardStyle}>
        <p style={cardTitle}>1. Download your store SKUs</p>
        <p style={{ color: muted, fontSize: '14px', lineHeight: 1.6, margin: '0 0 14px' }}>
          One row per store SKU, with the product it&apos;s on now. <strong style={{ color: text }}>suggested_product_sku</strong> groups store SKUs that look
          like the same product (ignoring capitals and + _ - spaces, FBA copies and Amazon resale SKUs); rows in a group sit together.
        </p>
        <button onClick={download} disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>Download spreadsheet (.xlsx)</button>
      </div>

      <div style={cardStyle}>
        <p style={cardTitle}>2. Fill in product_sku</p>
        <ul style={{ color: muted, fontSize: '14px', lineHeight: 1.7, margin: 0, paddingLeft: '20px' }}>
          <li><strong style={{ color: text }}>product_sku</strong>: the product each store SKU belongs to. Rows with the same product_sku become one product.
            Copy the suggested column across where you agree, and type your own clean SKU where you like (e.g. AM-12-1).</li>
          <li><strong style={{ color: text }}>product_name</strong>: the product&apos;s name (optional). Rows of one product should have the same name.</li>
          <li>An existing product SKU joins that product (its costs stay). A new SKU renames the product if all its store SKUs move together
            (so its costs stay too), otherwise a new product is created.</li>
          <li>Leave the other columns as they are. Rows you don&apos;t change are skipped.</li>
        </ul>
      </div>

      <div style={cardStyle}>
        <p style={cardTitle}>3. Upload it and check</p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} disabled={busy} style={{ color: muted, fontSize: '14px', display: 'block' }} />
        {status && <p style={{ color: busy ? muted : statusColor(status), fontSize: '14px', fontWeight: 600, margin: '14px 0 0', lineHeight: 1.5 }}>{status}</p>}
        {plan && <PlanPreview plan={plan} onApply={apply} busy={busy} />}
        {result && (
          <>
            <ImportSummary summary={result} />
            <p style={{ color: muted, fontSize: '13px', margin: '12px 0 0' }}>
              Next: add costs to any new products on <Link href="/products" style={{ color: muted }}>Products</Link>, then check{' '}
              <Link href="/costs" style={{ color: muted }}>Cost Check</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function keptMessage(products: Product[]) {
  const shown = products.slice(0, 10).map((p) => p.standard_sku).join(', ')
  return `${products.length.toLocaleString('en-GB')} products are left with no store SKUs but have costs or shipping set up, so they weren't removed: ${shown}${products.length > 10 ? '...' : ''}. Add those costs to the product their store SKUs moved to, then delete them on their product page.`
}

function PlanPreview({ plan, onApply, busy }: { plan: Plan; onApply: () => void; busy: boolean }) {
  const nothing = plan.moves.length + plan.renames.length + plan.creates.length + plan.nameChanges.length === 0
  const summary: ImportSummaryData = {
    headline: nothing ? 'No changes in this file' : `Ready: ${plan.moves.length.toLocaleString('en-GB')} store SKUs to move`,
    tone: plan.problems.length ? 'warn' : 'ok',
    sections: [
      {
        title: 'What will change',
        items: [
          plan.moves.length ? `${plan.moves.length.toLocaleString('en-GB')} store SKUs (and their sales) move to another product` : '',
          plan.renames.length ? `${plan.renames.length.toLocaleString('en-GB')} products get a new SKU (costs and shipping kept), e.g. ${plan.renames.slice(0, 3).map((r) => `${r.product.standard_sku} → ${r.toSku}`).join(', ')}` : '',
          plan.creates.length ? `${plan.creates.length.toLocaleString('en-GB')} new products, e.g. ${plan.creates.slice(0, 3).map((c) => c.sku).join(', ')}` : '',
          plan.nameChanges.length ? `${plan.nameChanges.length.toLocaleString('en-GB')} product names updated` : '',
          plan.deletes.length ? `${plan.deletes.length.toLocaleString('en-GB')} products left empty are removed (nothing was set up on them)` : '',
          `${plan.unchanged.toLocaleString('en-GB')} rows unchanged`,
        ].filter(Boolean),
      },
      ...(plan.keptWithCosts.length ? [{ title: 'Left for you to check', tone: 'warn' as const, items: [keptMessage(plan.keptWithCosts)] }] : []),
      ...(plan.problems.length
        ? [{ title: 'Skipped (fix in the file and upload again)', tone: 'warn' as const, items: [...plan.problems.slice(0, 20), ...(plan.problems.length > 20 ? [`and ${plan.problems.length - 20} more`] : [])] }]
        : []),
    ],
  }
  return (
    <>
      <ImportSummary summary={summary} />
      {plan.moves.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: '16px' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={thStyle}>Store</th>
                <th style={thStyle}>Store SKU</th>
                <th style={thStyle}>From product</th>
                <th style={thStyle}>To product</th>
              </tr>
            </thead>
            <tbody>
              {plan.moves.slice(0, 50).map((m) => (
                <tr key={m.listing.id}>
                  <td style={tdStyle}>{m.storeName}</td>
                  <td style={tdStyle}>{m.listing.platform_sku}</td>
                  <td style={{ ...tdStyle, color: muted }}>{m.fromSku}</td>
                  <td style={tdStyle}>{m.toSku}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.moves.length > 50 && <p style={{ color: muted, fontSize: '13px', margin: '8px 0 0' }}>First 50 of {plan.moves.length.toLocaleString('en-GB')} shown.</p>}
        </div>
      )}
      {!nothing && (
        <button onClick={onApply} disabled={busy} style={{ ...primaryButton, marginTop: '18px', opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Applying, please wait...' : 'Apply these changes'}
        </button>
      )}
    </>
  )
}

// Works out every change from the uploaded rows, without changing anything yet
function buildPlan(
  rows: Record<string, string>[],
  data: { stores: Store[]; listings: Listing[]; products: Product[]; hasSetup: Set<string> }
): Plan {
  const { stores, listings, products, hasSetup } = data
  const problems: string[] = []
  const storeOf = new Map(stores.map((s) => [s.id, s]))
  const productOf = new Map(products.map((p) => [p.id, p]))
  const listingById = new Map(listings.map((l) => [l.id, l]))
  const storeByLabel = new Map<string, Store>()
  stores.forEach((s) => {
    storeByLabel.set(storeLabel(s).toLowerCase(), s)
    storeByLabel.set(`${s.name} (${s.platforms?.name ?? ''})`.toLowerCase(), s)
    if (!storeByLabel.has(s.name.toLowerCase())) storeByLabel.set(s.name.toLowerCase(), s)
  })
  const listingByStoreSku = new Map(listings.map((l) => [`${l.store_id}|${l.platform_sku}`, l]))
  // Product SKUs match exactly, or ignoring capitals when only one product matches that way
  const productBySku = new Map(products.map((p) => [p.standard_sku, p]))
  const lowerCount = new Map<string, Product[]>()
  products.forEach((p) => lowerCount.set(p.standard_sku.toLowerCase(), [...(lowerCount.get(p.standard_sku.toLowerCase()) ?? []), p]))
  const findProduct = (sku: string) => productBySku.get(sku) ?? (lowerCount.get(sku.toLowerCase())?.length === 1 ? lowerCount.get(sku.toLowerCase())![0] : undefined)

  // 1. Each row's store SKU and the product SKU it should be on
  const wanted = new Map<string, { listing: Listing; toSku: string; toName: string }>()
  rows.forEach((row, i) => {
    const line = i + 2 // spreadsheet row number (after the heading row)
    const toSku = (row.product_sku || '').trim()
    const storeSku = (row.store_sku || '').trim()
    if (!storeSku && !toSku) return // blank row
    let listing = row.listing_id ? listingById.get(row.listing_id.trim()) : undefined
    if (!listing) {
      const store = storeByLabel.get((row.store || '').trim().toLowerCase())
      if (!store) return problems.push(`Row ${line}: no store called "${row.store}"`)
      listing = listingByStoreSku.get(`${store.id}|${storeSku}`)
      if (!listing) return problems.push(`Row ${line}: ${storeLabel(store)} has no store SKU "${storeSku}"`)
    }
    if (!toSku) return problems.push(`Row ${line}: ${listing.platform_sku} has no product_sku, so it was left where it is`)
    if (wanted.has(listing.id)) return problems.push(`Row ${line}: ${listing.platform_sku} is in the file twice; the first row was used`)
    wanted.set(listing.id, { listing, toSku, toName: (row.product_name || '').trim() })
  })

  // 2. Group by target product SKU
  const byTarget = new Map<string, { listing: Listing; toName: string }[]>()
  for (const w of wanted.values()) {
    const existing = findProduct(w.toSku)
    const key = existing ? existing.standard_sku : w.toSku
    if (!byTarget.has(key)) byTarget.set(key, [])
    byTarget.get(key)!.push(w)
  }
  // How many store SKUs each product has now, and how many are staying on it
  const listingsOf = new Map<string, number>()
  listings.forEach((l) => listingsOf.set(l.master_product_id, (listingsOf.get(l.master_product_id) ?? 0) + 1))

  const plan: Plan = { moves: [], renames: [], creates: [], nameChanges: [], deletes: [], keptWithCosts: [], targetOf: new Map(), problems, unchanged: 0 }
  const allTargets = new Set(byTarget.keys())

  for (const [toSku, members] of byTarget) {
    const name = members.find((m) => m.toName)?.toName ?? ''
    const existing = findProduct(toSku)
    let keeperId: string | undefined
    if (existing) {
      keeperId = existing.id
      plan.targetOf.set(toSku, { productId: existing.id })
      if (name && name !== existing.name) plan.nameChanges.push({ product: existing, toName: name })
    } else {
      // A brand-new SKU: if every store SKU of one product moves here, that product simply takes
      // the new SKU (keeping its costs). Prefer one with costs set up.
      const sources = Array.from(new Set(members.map((m) => m.listing.master_product_id)))
      const whole = sources.filter((pid) => {
        const p = productOf.get(pid)
        return p && members.filter((m) => m.listing.master_product_id === pid).length === listingsOf.get(pid)
          // never rename a product whose SKU is wanted by other rows
          && !allTargets.has(p.standard_sku)
      })
      whole.sort((a, b) => Number(hasSetup.has(b)) - Number(hasSetup.has(a)))
      const keeper = whole[0] ? productOf.get(whole[0]) : undefined
      if (keeper) {
        keeperId = keeper.id
        plan.renames.push({ product: keeper, toSku, toName: name || keeper.name })
      } else {
        const first = productOf.get(members[0].listing.master_product_id)
        plan.creates.push({ sku: toSku, name: name || toSku, vatRate: first?.vat_rate ?? null })
      }
      plan.targetOf.set(toSku, { newSku: toSku })
    }
    for (const m of members) {
      if (m.listing.master_product_id === keeperId) {
        plan.unchanged++
        continue
      }
      plan.moves.push({
        listing: m.listing,
        storeName: storeLabel(storeOf.get(m.listing.store_id)),
        fromSku: productOf.get(m.listing.master_product_id)?.standard_sku ?? '?',
        toSku,
      })
    }
  }
  // Renames and moves of the same product aren't counted twice as unchanged rows
  plan.unchanged -= plan.renames.reduce((n, r) => n + (listingsOf.get(r.product.id) ?? 0), 0)
  plan.unchanged = Math.max(0, plan.unchanged)

  // 3. Products every store SKU moves away from
  const movingAway = new Map<string, number>()
  plan.moves.forEach((m) => movingAway.set(m.listing.master_product_id, (movingAway.get(m.listing.master_product_id) ?? 0) + 1))
  for (const [pid, n] of movingAway) {
    if (n < (listingsOf.get(pid) ?? 0)) continue
    const p = productOf.get(pid)
    if (!p) continue
    if (hasSetup.has(pid)) plan.keptWithCosts.push(p)
    else plan.deletes.push(p)
  }
  return plan
}
