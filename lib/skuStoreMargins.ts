import { supabase } from './supabase'
import { fetchAll } from './fetchAll'
import { loadOverheadSetup, allocateOverheads } from './overheads'

// Net margin per product × store for a date range (or all time), plus which products
// are listed where. Shared by /margins and /opportunities so the two pages always agree.

export type MarginCell = { revenuePence: number; marginPence: number; units: number }

export type SkuStoreMargins = {
  products: { id: string; name: string }[] // sorted by name
  stores: { id: string; name: string }[] // sorted by name
  overheadNote: string
  cell: (productId: string, storeId: string) => MarginCell | null // null = no sales in the period
  total: (productId: string) => MarginCell | null // all stores together
  notListed: (productId: string, storeId: string) => boolean
}

// Margin % from the summed totals (never an average of per-order percentages)
export function cellPercent(cell: MarginCell | null): number | null {
  if (!cell || cell.revenuePence === 0) return null
  return Math.round((cell.marginPence / cell.revenuePence) * 1000) / 10
}

export function cellPerUnitPence(cell: MarginCell | null): number | null {
  if (!cell || cell.units === 0) return null
  return Math.round(cell.marginPence / cell.units)
}

export async function loadSkuStoreMargins(
  includeOverheads: boolean,
  range: { from: string; to: string } | null = null // null = all time
): Promise<{ error: string } | SkuStoreMargins> {
  const [{ data, error }, { data: listings, error: listingsError }] = await Promise.all([
    fetchAll((from, to) => {
      let q = supabase
        .from('order_margins')
        .select('master_product_id, product_name, channel, store_id, order_date, effective_qty, revenue_pence, margin_pence')
      if (range) q = q.gte('order_date', range.from).lte('order_date', range.to)
      return q.order('order_line_item_id').range(from, to)
    }),
    // Which products are listed in which stores, so "not listed" can be told apart from "listed, no sales"
    fetchAll((from, to) =>
      supabase
        .from('platform_listings')
        .select('id, master_product_id, store_id, master_products(name), stores(name)')
        .order('id')
        .range(from, to)
    ),
  ])
  if (error || listingsError) return { error: (error || listingsError)!.message }

  const products = new Map<string, string>() // id -> name
  const storeNames = new Map<string, string>() // id -> name
  const listed = new Set<string>() // `${productId}|${storeId}`
  const cells = new Map<string, MarginCell>()
  const totals = new Map<string, MarginCell>()

  // Only stores with at least one listing or sale are included, so a store whose
  // catalogue hasn't been mapped yet doesn't show every product as "not listed"
  for (const l of listings as any[]) {
    products.set(l.master_product_id, l.master_products?.name ?? '?')
    storeNames.set(l.store_id, l.stores?.name ?? '?')
    listed.add(`${l.master_product_id}|${l.store_id}`)
  }

  // Optionally take each sale's share of overheads off its margin, for the chosen
  // period (all time = first order date to the last).
  let overheadNote = ''
  let overheadShares: number[] = []
  if (includeOverheads && data.length > 0) {
    const dates = data.map((r) => r.order_date).sort()
    const from = range?.from ?? dates[0]
    const to = range?.to ?? dates[dates.length - 1]
    const allocation = allocateOverheads(data, await loadOverheadSetup(), from, to)
    overheadShares = allocation.shares
    overheadNote = `Includes £${(allocation.totalPence / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })} of overheads from ${from} to ${to}, shared across sales.`
  }

  // Sum revenue, margin and units per product × store FIRST; percentages come from the totals
  const add = (map: Map<string, MarginCell>, key: string, revenue: number, margin: number, units: number) => {
    const c = map.get(key) || { revenuePence: 0, marginPence: 0, units: 0 }
    c.revenuePence += revenue
    c.marginPence += margin
    c.units += units
    map.set(key, c)
  }
  for (const [i, row] of data.entries()) {
    products.set(row.master_product_id, row.product_name)
    storeNames.set(row.store_id, row.channel)
    const revenue = Number(row.revenue_pence) || 0
    const margin = (Number(row.margin_pence) || 0) - (overheadShares[i] || 0)
    const units = Number(row.effective_qty) || 0
    add(cells, `${row.master_product_id}|${row.store_id}`, revenue, margin, units)
    add(totals, row.master_product_id, revenue, margin, units)
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  return {
    products: Array.from(products, ([id, name]) => ({ id, name })).sort(byName),
    stores: Array.from(storeNames, ([id, name]) => ({ id, name })).sort(byName),
    overheadNote,
    cell: (productId, storeId) => cells.get(`${productId}|${storeId}`) ?? null,
    total: (productId) => totals.get(productId) ?? null,
    // Not mapped in this store and no sales there either
    notListed(productId, storeId) {
      const key = `${productId}|${storeId}`
      return !listed.has(key) && !cells.has(key)
    },
  }
}
