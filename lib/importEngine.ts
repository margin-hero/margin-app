import { supabase } from './supabase'

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
  skippedNoSku: string[]
  errors: string[]
}

// Shared by every platform importer: given a platform name and a list of already-parsed
// orders in our standard shape, this handles SKU matching, auto-creating unrecognised
// products, dedupe against existing orders, and the actual insert.
// Each platform's import page only needs to handle turning its own raw export into
// NormalizedOrder[] — everything after that is identical and lives here once.
export async function importOrdersForPlatform(
  platformName: string,
  orders: NormalizedOrder[],
  onProgress?: (message: string) => void
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skippedDuplicates: 0, skippedNoSku: [], errors: [] }

  onProgress?.('Looking up platform...')
  const { data: platform, error: platformError } = await supabase
    .from('platforms')
    .select('id')
    .eq('name', platformName)
    .single()

  if (platformError || !platform) {
    result.errors.push(`Platform "${platformName}" not found: ${platformError?.message || 'no match'}`)
    return result
  }

  onProgress?.('Loading existing listings...')
  const { data: listings, error: listingsError } = await supabase
    .from('platform_listings')
    .select('id, platform_sku')
    .eq('platform_id', platform.id)

  if (listingsError) {
    result.errors.push(`Error loading listings: ${listingsError.message}`)
    return result
  }

  const skuToListingId = new Map(listings.map((l) => [l.platform_sku, l.id]))

  const uniqueSkus = Array.from(new Set(orders.map((o) => o.sku)))
  const newSkus = uniqueSkus.filter((sku) => !skuToListingId.has(sku))

  if (newSkus.length > 0) {
    onProgress?.(`Creating ${newSkus.length} new products for unrecognised SKUs...`)
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .eq('name', 'Test Store')
      .single()

    if (tenantError || !tenant) {
      result.errors.push(`Error looking up tenant: ${tenantError?.message || 'not found'}`)
      return result
    }

    // Check if any of these SKUs already exist as a master product's standard_sku
    // (e.g. the same seller SKU text used across two different platforms) —
    // reuse that product instead of creating a duplicate.
    const { data: existingProducts, error: existingProductsError } = await supabase
      .from('master_products')
      .select('id, standard_sku')
      .eq('tenant_id', tenant.id)
      .in('standard_sku', newSkus)

    if (existingProductsError) {
      result.errors.push(`Error checking existing products: ${existingProductsError.message}`)
      return result
    }

    const existingProductBySku = new Map(existingProducts.map((p) => [p.standard_sku, p.id]))

    for (const sku of newSkus) {
      let productId = existingProductBySku.get(sku)

      if (!productId) {
        const { data: newProduct, error: productError } = await supabase
          .from('master_products')
          .insert({ tenant_id: tenant.id, standard_sku: sku, name: sku })
          .select('id')
          .single()

        if (productError || !newProduct) {
          result.errors.push(`${sku}: ${productError?.message || 'unknown error'}`)
          continue
        }
        productId = newProduct.id
      }

      const { data: newListing, error: listingError } = await supabase
        .from('platform_listings')
        .insert({ master_product_id: productId, platform_id: platform.id, platform_sku: sku })
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
  for (let i = 0; i < candidateRows.length; i += chunkSize) {
    const chunk = candidateRows.slice(i, i + chunkSize)
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
