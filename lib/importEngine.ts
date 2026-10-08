import { supabase } from './supabase'
import { Store } from './stores'
import { fetchAll } from './fetchAll'
import { FeeLine, addFee, feeTotals } from './fees'

export type NormalizedOrder = {
  sku: string
  externalId: string
  orderDate: string // 'YYYY-MM-DD'
  qty: number
  salePriceGrossPence: number
  saleVatPence: number | null // null = the channel doesn't report it: worked out from the product's VAT rate
  feesGrossPence: number
  feesVatPence: number
  // The fees split by type (optional). Whatever doesn't add up to the totals above is
  // saved as 'Not broken down', so the breakdown always matches the totals.
  feeBreakdown?: FeeLine[]
  actualShippingCostPence?: number | null
  shippingRevenueGrossPence?: number
  shippingRevenueVatPence?: number | null // null = worked out from the product's VAT rate
}

// A refund against an earlier sale. Amounts are what was given back (positive), except
// feesGrossPence / feesVatPence: the change in fees as a cost, so negative when the channel
// returns more fees than it keeps (e.g. Amazon gives back the commission, keeps a refund fee).
export type NormalizedRefund = {
  sku: string
  externalId: string // the refund's own ID (unique per store SKU)
  originalExternalId: string | null // the sale's externalId, to link the two
  refundDate: string // 'YYYY-MM-DD'
  qty: number | null // null = the channel doesn't say: worked out from the refunded price
  refundGrossPence: number
  refundVatPence: number | null // null = worked out from the product's VAT rate
  shippingRefundGrossPence?: number
  shippingRefundVatPence?: number | null
  feesGrossPence: number
  feesVatPence: number
  feeBreakdown?: FeeLine[]
  returnShippingCostPence?: number | null // return label paid by the seller, inc. VAT
}

export type ImportResult = {
  imported: number
  skippedDuplicates: number
  skippedNoSku: string[] // one entry per order line held back because its SKU isn't mapped
  unmappedSkus: string[] // the distinct SKUs behind skippedNoSku
  autoLinked: string[] // SKUs linked automatically because they exactly match a product's standard SKU
  createdProducts: string[] // SKUs that got a brand-new product (only when createUnknownSkus is on)
  errors: string[]
  refundsImported: number
  refundsSkippedDuplicates: number
  refundsSkippedNoSku: number // held back because their SKU isn't mapped
}

export type ImportOptions = {
  // false (default): SKUs that aren't mapped in this store are held back and listed,
  // so the product list stays clean. true: create a new product for each one.
  createUnknownSkus?: boolean
  refunds?: NormalizedRefund[] // imported alongside the orders (same SKU matching)
}

// Shared by every platform importer: given the store the file belongs to and a list of
// already-parsed orders in our standard shape, this handles SKU matching, unmapped SKUs
// (held back, or auto-created if asked), dedupe against existing orders, and the insert.
// Each platform's import page only needs to handle turning its own raw export into
// NormalizedOrder[] — everything after that is identical and lives here once.
export async function importOrdersForStore(
  store: Store,
  orders: NormalizedOrder[],
  onProgress?: (message: string) => void,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0, skippedDuplicates: 0, skippedNoSku: [], unmappedSkus: [], autoLinked: [], createdProducts: [], errors: [],
    refundsImported: 0, refundsSkippedDuplicates: 0, refundsSkippedNoSku: 0,
  }
  const refunds = options.refunds || []

  onProgress?.('Loading existing listings...')
  const { data: listings, error: listingsError } = await fetchAll((from, to) =>
    supabase
      .from('platform_listings')
      .select('id, platform_sku')
      .eq('store_id', store.id)
      .order('id')
      .range(from, to)
  )

  if (listingsError) {
    result.errors.push(`Error loading listings: ${listingsError.message}`)
    return result
  }

  const skuToListingId = new Map(listings.map((l) => [l.platform_sku, l.id]))

  const uniqueSkus = Array.from(new Set([...orders.map((o) => o.sku), ...refunds.map((r) => r.sku)]))
  const newSkus = uniqueSkus.filter((sku) => !skuToListingId.has(sku))

  if (newSkus.length > 0) {
    onProgress?.(`Checking ${newSkus.length} SKUs not yet mapped in this store...`)

    // If a SKU exactly matches a master product's standard_sku (e.g. the same seller
    // SKU used across two stores), link it to that product — no new product needed.
    // An Amazon FBA SKU that's a product's SKU plus "FBA" (e.g. LL-1-FBA) links to that product too.
    // Checked in batches: a very long list of SKUs won't fit in one request
    const fbaBase = (sku: string) => sku.replace(/[-_ ]?FBA$/i, '')
    const lookupSkus = Array.from(new Set([...newSkus, ...newSkus.map(fbaBase)]))
    const existingProductBySku = new Map<string, string>()
    for (let i = 0; i < lookupSkus.length; i += 200) {
      const { data: existingProducts, error: existingProductsError } = await supabase
        .from('master_products')
        .select('id, standard_sku')
        .eq('tenant_id', store.tenant_id)
        .in('standard_sku', lookupSkus.slice(i, i + 200))

      if (existingProductsError) {
        result.errors.push(`Error checking existing products: ${existingProductsError.message}`)
        return result
      }
      existingProducts.forEach((p) => existingProductBySku.set(p.standard_sku, p.id))
    }

    for (const sku of newSkus) {
      let productId = existingProductBySku.get(sku) ?? (fbaBase(sku) !== sku ? existingProductBySku.get(fbaBase(sku)) : undefined)

      if (!productId && !options.createUnknownSkus) {
        result.unmappedSkus.push(sku) // held back: the orders are skipped below
        continue
      }

      if (productId) {
        result.autoLinked.push(sku)
      } else {
        const { data: newProduct, error: productError } = await supabase
          .from('master_products')
          .insert({ tenant_id: store.tenant_id, standard_sku: sku, name: sku })
          .select('id')
          .single()

        if (productError || !newProduct) {
          result.errors.push(`${sku}: ${productError?.message || 'unknown error'}`)
          continue
        }
        productId = newProduct.id
        result.createdProducts.push(sku)
      }

      const { data: newListing, error: listingError } = await supabase
        .from('platform_listings')
        .insert({ master_product_id: productId, store_id: store.id, platform_id: store.platform_id, platform_sku: sku })
        .select('id')
        .single()

      if (listingError || !newListing) {
        result.errors.push(`${sku} (listing): ${listingError?.message || 'unknown error'}`)
        continue
      }

      skuToListingId.set(sku, newListing.id)
    }
  }

  if (result.errors.length > 0) return result

  // Some channels (e.g. OnBuy) don't report the VAT inside the sale price for UK sellers.
  // For those orders, work it out from each product's VAT rate (VAT = gross × rate ÷ (1 + rate)).
  const vatRateByListing = new Map<unknown, number>()
  if (
    orders.some((o) => o.saleVatPence === null || o.shippingRevenueVatPence === null) ||
    refunds.some((r) => r.refundVatPence === null || r.shippingRefundVatPence === null)
  ) {
    onProgress?.('Looking up product VAT rates...')
    const listingIds = Array.from(new Set([...orders, ...refunds].map((o) => skuToListingId.get(o.sku)).filter((id) => id !== undefined)))
    for (let i = 0; i < listingIds.length; i += 200) {
      const { data: rates, error: ratesError } = await supabase
        .from('platform_listings')
        .select('id, master_products(vat_rate)')
        .in('id', listingIds.slice(i, i + 200))
      if (ratesError) {
        result.errors.push(`Error loading product VAT rates: ${ratesError.message}`)
        return result
      }
      // A product without a VAT rate is treated as standard rate (20%)
      rates.forEach((r: any) => vatRateByListing.set(r.id, Number(r.master_products?.vat_rate ?? 0.2)))
    }
  }
  const vatFromGross = (grossPence: number, listingId: unknown) => {
    const rate = vatRateByListing.get(listingId) ?? 0.2
    return Math.round((grossPence * rate) / (1 + rate))
  }

  onProgress?.('Preparing rows...')
  const candidateRows: any[] = []
  const feesByKey = new Map<string, FeeLine[]>() // by `${listing id}|${external id}`
  for (const order of orders) {
    const listingId = skuToListingId.get(order.sku)
    if (!listingId) {
      result.skippedNoSku.push(order.sku)
      continue
    }
    const shippingGross = order.shippingRevenueGrossPence ?? 0
    candidateRows.push({
      platform_listing_id: listingId,
      external_id: order.externalId,
      order_date: order.orderDate,
      qty: order.qty,
      sale_price_gross_pence: order.salePriceGrossPence,
      sale_vat_pence: order.saleVatPence ?? vatFromGross(order.salePriceGrossPence, listingId),
      fees_gross_pence: order.feesGrossPence,
      fees_vat_pence: order.feesVatPence,
      actual_shipping_cost_pence: order.actualShippingCostPence ?? null,
      shipping_revenue_gross_pence: shippingGross,
      shipping_revenue_vat_pence: order.shippingRevenueVatPence === null ? vatFromGross(shippingGross, listingId) : (order.shippingRevenueVatPence ?? 0),
    })
    feesByKey.set(`${listingId}|${order.externalId}`, completeFeeBreakdown(order))
  }

  onProgress?.('Checking for already-imported orders...')
  const newRows = await withoutExisting('order_line_items', candidateRows, result)
  if (!newRows) return result
  result.skippedDuplicates = candidateRows.length - newRows.length

  onProgress?.(`Importing ${newRows.length} new order lines...`)
  const ordersOk = await insertWithFees('order_line_items', 'order_line_item_id', newRows, feesByKey, result, (n) => (result.imported += n))
  if (!ordersOk || refunds.length === 0) return result

  // Refunds: same SKU matching and dedupe, into their own table
  const refundRows: any[] = []
  const refundFeesByKey = new Map<string, FeeLine[]>()
  for (const refund of refunds) {
    const listingId = skuToListingId.get(refund.sku)
    if (!listingId) {
      result.refundsSkippedNoSku++
      continue
    }
    const shippingGross = refund.shippingRefundGrossPence ?? 0
    refundRows.push({
      platform_listing_id: listingId,
      external_id: refund.externalId,
      original_external_id: refund.originalExternalId,
      refund_date: refund.refundDate,
      qty: refund.qty,
      refund_gross_pence: refund.refundGrossPence,
      refund_vat_pence: refund.refundVatPence ?? vatFromGross(refund.refundGrossPence, listingId),
      shipping_refund_gross_pence: shippingGross,
      shipping_refund_vat_pence: refund.shippingRefundVatPence === null ? vatFromGross(shippingGross, listingId) : (refund.shippingRefundVatPence ?? 0),
      fees_gross_pence: refund.feesGrossPence,
      fees_vat_pence: refund.feesVatPence,
      return_shipping_cost_pence: refund.returnShippingCostPence ?? null,
    })
    refundFeesByKey.set(`${listingId}|${refund.externalId}`, completeFeeBreakdown(refund))
  }

  onProgress?.('Checking for already-imported refunds...')
  const newRefunds = await withoutExisting('order_refunds', refundRows, result)
  if (!newRefunds) return result
  result.refundsSkippedDuplicates = refundRows.length - newRefunds.length

  onProgress?.(`Importing ${newRefunds.length} new refunds...`)
  await insertWithFees('order_refunds', 'order_refund_id', newRefunds, refundFeesByKey, result, (n) => (result.refundsImported += n))
  return result
}

// Drops rows already in the table (same store SKU + external ID), so re-uploads are safe.
// Returns null (with the error in result) if the check fails.
async function withoutExisting(table: 'order_line_items' | 'order_refunds', rows: any[], result: ImportResult) {
  const existingKeys = new Set<string>()
  // Small batches so each lookup stays well under Supabase's 1,000-row limit
  for (let i = 0; i < rows.length; i += 200) {
    const { data: existing, error } = await supabase
      .from(table)
      .select('platform_listing_id, external_id')
      .in('external_id', rows.slice(i, i + 200).map((r) => r.external_id))
    if (error) {
      result.errors.push(`Error checking duplicates: ${error.message}`)
      return null
    }
    existing?.forEach((e) => existingKeys.add(`${e.platform_listing_id}|${e.external_id}`))
  }
  return rows.filter((r) => !existingKeys.has(`${r.platform_listing_id}|${r.external_id}`))
}

// Inserts the rows in batches, then each row's fee breakdown (one row per fee type).
// Returns false (with the error in result) if anything fails.
async function insertWithFees(
  table: 'order_line_items' | 'order_refunds',
  feeParentColumn: 'order_line_item_id' | 'order_refund_id',
  rows: any[],
  feesByKey: Map<string, FeeLine[]>,
  result: ImportResult,
  onInserted: (count: number) => void
): Promise<boolean> {
  const what = table === 'order_refunds' ? 'refunds' : 'order lines'
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { data: inserted, error: insertError } = await supabase
      .from(table)
      .insert(chunk)
      .select('id, platform_listing_id, external_id')
    if (insertError || !inserted) {
      result.errors.push(`Import error on ${what} batch starting at row ${i}: ${insertError?.message || 'unknown error'}`)
      return false
    }
    onInserted(chunk.length)

    const feeRows = inserted.flatMap((row) =>
      (feesByKey.get(`${row.platform_listing_id}|${row.external_id}`) || []).map((fee) => ({
        [feeParentColumn]: row.id,
        fee_type: fee.type,
        source_label: fee.label,
        gross_pence: fee.grossPence,
        vat_pence: fee.vatPence,
      }))
    )
    for (let j = 0; j < feeRows.length; j += 500) {
      const { error: feeError } = await supabase.from('order_line_fees').insert(feeRows.slice(j, j + 500))
      if (feeError) {
        result.errors.push(
          `Some ${what} were imported, but saving their fee breakdown failed: ${feeError.message}. ` +
          `Their margins are still correct (fee totals are saved); only the split by fee type is missing.`
        )
        return false
      }
    }
  }
  return true
}

// The fee breakdown, topped up so it adds up exactly to the fee totals:
// anything the importer didn't split out is 'Not broken down'.
function completeFeeBreakdown(order: { feesGrossPence: number; feesVatPence: number; feeBreakdown?: FeeLine[] }): FeeLine[] {
  const lines = (order.feeBreakdown || []).filter((l) => l.grossPence || l.vatPence).map((l) => ({ ...l }))
  const totals = feeTotals(lines)
  addFee(lines, 'unspecified', 'Fees (not broken down)', order.feesGrossPence - totals.grossPence, order.feesVatPence - totals.vatPence)
  return lines
}

// A delivery label transaction bought through the channel, for one order (Amazon so far).
// Saved separately from the order lines, so a carrier's later adjustment or refunded label
// still counts when its sale was imported from an earlier file. order_margins adds up an
// order's labels (once its purchase is in) and shares them across the order's lines.
export type NormalizedLabelCharge = {
  orderRef: string // the channel's order ID, matching the order lines' externalId
  chargeDate: string // 'YYYY-MM-DD'
  kind: 'label' | 'adjustment' | 'refund'
  description: string
  amountPence: number // inc. VAT; negative = money back
  sourceKey: string // unique per transaction, so re-uploads are skipped
}

// Saves label charges for the store that ships the orders; ones already saved are skipped
export async function importShippingLabelCharges(
  store: Store,
  charges: NormalizedLabelCharge[],
  onProgress?: (message: string) => void
): Promise<{ added: number; skipped: number; error: string | null }> {
  let added = 0
  for (let i = 0; i < charges.length; i += 500) {
    onProgress?.(`Saving delivery labels (${count(i)} of ${count(charges.length)})...`)
    const rows = charges.slice(i, i + 500).map((c) => ({
      store_id: store.id,
      order_ref: c.orderRef,
      charge_date: c.chargeDate,
      kind: c.kind,
      description: c.description,
      amount_pence: c.amountPence,
      source_key: c.sourceKey,
    }))
    const { data, error } = await supabase
      .from('shipping_label_charges')
      .upsert(rows, { onConflict: 'store_id,source_key', ignoreDuplicates: true })
      .select('id')
    if (error) return { added, skipped: i - added, error: error.message }
    added += data?.length ?? 0
  }
  return { added, skipped: charges.length - added, error: null }
}

// A summary shown as a headline plus short grouped lists (components/ImportSummary.tsx).
// tone: 'ok' = all good, 'warn' = something needs your attention, 'error' = it failed.
export type ImportSummaryData = {
  headline: string
  tone: 'ok' | 'warn' | 'error'
  sections: { title: string; items: string[]; tone?: 'warn' }[]
}

const count = (n: number) => n.toLocaleString('en-GB')

// The result of an import, as grouped lists: one consistent message for every import page
export function importResultSummary(result: ImportResult, store: Store): ImportSummaryData {
  if (result.errors.length > 0) {
    return {
      headline: `${store.name}: the import stopped with an error`,
      tone: 'error',
      sections: [{ title: 'Errors', items: result.errors.slice(0, 5).concat(result.errors.length > 5 ? [`and ${result.errors.length - 5} more`] : []) }],
    }
  }
  const heldBack = result.skippedNoSku.length + result.refundsSkippedNoSku
  const sections: ImportSummaryData['sections'] = [
    {
      title: 'Imported',
      items: [
        `${count(result.imported)} new order lines`,
        result.refundsImported ? `${count(result.refundsImported)} new refunds` : '',
      ],
    },
    {
      title: 'Already imported (skipped, so nothing is counted twice)',
      items: [
        result.skippedDuplicates ? `${count(result.skippedDuplicates)} order lines` : '',
        result.refundsSkippedDuplicates ? `${count(result.refundsSkippedDuplicates)} refunds` : '',
      ],
    },
    {
      title: 'Held back',
      tone: 'warn',
      items: heldBack
        ? [
            result.skippedNoSku.length
              ? `${count(result.skippedNoSku.length)} order lines, because ${count(result.unmappedSkus.length)} SKUs aren't set up in this store: ${result.unmappedSkus.slice(0, 20).join(', ')}${result.unmappedSkus.length > 20 ? ` and ${result.unmappedSkus.length - 20} more` : ''}`
              : '',
            result.refundsSkippedNoSku ? `${count(result.refundsSkippedNoSku)} refunds whose SKU isn't set up in this store` : '',
            'Add them on Store SKUs (or Catalog Import), then upload the same file again. Already-imported orders won\'t be duplicated.',
          ]
        : [],
    },
    {
      title: 'Linked automatically',
      items: result.autoLinked.length
        ? [`${count(result.autoLinked.length)} SKUs matched products with the same SKU (or the same SKU plus "FBA"): ${result.autoLinked.slice(0, 10).join(', ')}${result.autoLinked.length > 10 ? '...' : ''}`]
        : [],
    },
    {
      title: 'New products',
      items: result.createdProducts.length ? [`${count(result.createdProducts.length)} created: add their costs on Products`] : [],
    },
  ]
  return {
    headline: `${store.name}: ${count(result.imported)} new order lines${result.refundsImported ? ` and ${count(result.refundsImported)} refunds` : ''} imported`,
    tone: heldBack ? 'warn' : 'ok',
    sections: sections.map((s) => ({ ...s, items: s.items.filter(Boolean) })).filter((s) => s.items.length > 0),
  }
}
