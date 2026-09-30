import { supabase } from './supabase'
import { Store } from './stores'
import { fetchAll } from './fetchAll'

export type NormalizedOrder = {
  sku: string
  externalId: string
  orderDate: string // 'YYYY-MM-DD'
  qty: number
  salePriceGrossPence: number
  saleVatPence: number
  feesGrossPence: number
  feesVatPence: number
  actualShippingCostPence?: number | null
  shippingRevenueGrossPence?: number
  shippingRevenueVatPence?: number
}

export type ImportResult = {
  imported: number
  skippedDuplicates: number
  skippedNoSku: string[] // one entry per order line held back because its SKU isn't mapped
  unmappedSkus: string[] // the distinct SKUs behind skippedNoSku
  autoLinked: string[] // SKUs linked automatically because they exactly match a product's standard SKU
  createdProducts: string[] // SKUs that got a brand-new product (only when createUnknownSkus is on)
  errors: string[]
}

export type ImportOptions = {
  // false (default): SKUs that aren't mapped in this store are held back and listed,
  // so the product list stays clean. true: create a new product for each one.
  createUnknownSkus?: boolean
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
  }

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

  const uniqueSkus = Array.from(new Set(orders.map((o) => o.sku)))
  const newSkus = uniqueSkus.filter((sku) => !skuToListingId.has(sku))

  if (newSkus.length > 0) {
    onProgress?.(`Checking ${newSkus.length} SKUs not yet mapped in this store...`)

    // If a SKU exactly matches a master product's standard_sku (e.g. the same seller
    // SKU used across two stores), link it to that product — no new product needed.
    // Checked in batches: a very long list of SKUs won't fit in one request
    const existingProductBySku = new Map<string, string>()
    for (let i = 0; i < newSkus.length; i += 200) {
      const { data: existingProducts, error: existingProductsError } = await supabase
        .from('master_products')
        .select('id, standard_sku')
        .eq('tenant_id', store.tenant_id)
        .in('standard_sku', newSkus.slice(i, i + 200))

      if (existingProductsError) {
        result.errors.push(`Error checking existing products: ${existingProductsError.message}`)
        return result
      }
      existingProducts.forEach((p) => existingProductBySku.set(p.standard_sku, p.id))
    }

    for (const sku of newSkus) {
      let productId = existingProductBySku.get(sku)

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

  onProgress?.('Preparing rows...')
  const candidateRows: any[] = []
  for (const order of orders) {
    const listingId = skuToListingId.get(order.sku)
    if (!listingId) {
      result.skippedNoSku.push(order.sku)
      continue
    }
    candidateRows.push({
      platform_listing_id: listingId,
      external_id: order.externalId,
      order_date: order.orderDate,
      qty: order.qty,
      sale_price_gross_pence: order.salePriceGrossPence,
      sale_vat_pence: order.saleVatPence,
      fees_gross_pence: order.feesGrossPence,
      fees_vat_pence: order.feesVatPence,
      actual_shipping_cost_pence: order.actualShippingCostPence ?? null,
      shipping_revenue_gross_pence: order.shippingRevenueGrossPence ?? 0,
      shipping_revenue_vat_pence: order.shippingRevenueVatPence ?? 0,
    })
  }

  onProgress?.('Checking for already-imported orders...')
  const chunkSize = 500
  const existingKeys = new Set<string>()
  // Smaller batches here so each lookup stays well under Supabase's 1,000-row limit
  const lookupSize = 200
  for (let i = 0; i < candidateRows.length; i += lookupSize) {
    const chunk = candidateRows.slice(i, i + lookupSize)
    const { data: existing, error: existingError } = await supabase
      .from('order_line_items')
      .select('platform_listing_id, external_id')
      .in('external_id', chunk.map((r) => r.external_id))

    if (existingError) {
      result.errors.push(`Error checking duplicates: ${existingError.message}`)
      return result
    }

    existing?.forEach((e) => existingKeys.add(`${e.platform_listing_id}|${e.external_id}`))
  }

  const newRows = candidateRows.filter((r) => !existingKeys.has(`${r.platform_listing_id}|${r.external_id}`))
  result.skippedDuplicates = candidateRows.length - newRows.length

  onProgress?.(`Importing ${newRows.length} new order lines...`)
  for (let i = 0; i < newRows.length; i += chunkSize) {
    const chunk = newRows.slice(i, i + chunkSize)
    const { error: insertError } = await supabase.from('order_line_items').insert(chunk)
    if (insertError) {
      result.errors.push(`Import error on batch starting at row ${i}: ${insertError.message}`)
      return result
    }
    result.imported += chunk.length
  }

  return result
}

// One consistent summary message for every import page.
export function describeImportResult(result: ImportResult, store: Store): string {
  if (result.errors.length > 0) {
    return `Errors: ${result.errors.slice(0, 3).join(' | ')}${result.errors.length > 3 ? '...' : ''}`
  }
  const parts = [
    `Done. Imported ${result.imported} new order lines into ${store.name}.`,
    `Skipped ${result.skippedDuplicates} already-imported.`,
  ]
  if (result.autoLinked.length) {
    parts.push(`Linked ${result.autoLinked.length} SKU(s) to existing products with the same SKU.`)
  }
  if (result.createdProducts.length) {
    parts.push(`Created ${result.createdProducts.length} new product(s) — add their costs in Products.`)
  }
  if (result.unmappedSkus.length) {
    const shown = result.unmappedSkus.slice(0, 20).join(', ')
    const more = result.unmappedSkus.length > 20 ? ` and ${result.unmappedSkus.length - 20} more` : ''
    parts.push(
      `HELD BACK ${result.skippedNoSku.length} order line(s) because ${result.unmappedSkus.length} SKU(s) aren't mapped in this store: ${shown}${more}. ` +
      `Map them (Catalog Import or Mappings), then upload the same file again — already-imported orders won't be duplicated.`
    )
  }
  return parts.join(' ')
}
