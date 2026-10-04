import { connection } from 'next/server'
import { createServerSupabase } from '@/lib/supabaseServer'
import { fetchAll } from '@/lib/fetchAll'
import { loadMarginRanges } from '@/lib/marginRanges'
import { loadStores } from '@/lib/stores'
import { red, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle } from '@/lib/theme'
import OrderLinesTable, { OrderLine } from './OrderLinesTable'

// Unlisted page (not in the sidebar): every order line with its cost breakdown, for
// checking calculations while testing. Customers use /margins instead.
export default async function OrderLinesPage() {
  // Render on every visit so this shows live data, not a snapshot from build time
  await connection()
  const supabase = await createServerSupabase()

  const [{ data, error }, { data: products, error: productsError }, stores, ranges] = await Promise.all([
    fetchAll((from, to) => supabase.from('order_margins').select('*').order('order_date', { ascending: false }).order('order_line_item_id').range(from, to)),
    fetchAll((from, to) => supabase.from('master_products').select('id, standard_sku').order('id').range(from, to)),
    loadStores(supabase),
    loadMarginRanges(supabase),
  ])

  if (error || productsError) {
    return <div style={{ ...pageStyle, color: red }}>Error: {(error || productsError)!.message}</div>
  }

  const skuOf = new Map(products.map((p) => [p.id, p.standard_sku as string]))
  const storeOf = new Map(stores.map((s) => [s.id, s]))

  const lines: OrderLine[] = data.map((row) => {
    const store = storeOf.get(row.store_id)
    return {
      id: row.order_line_item_id,
      date: row.order_date,
      channel: store?.platforms?.name ?? '',
      store: store?.name ?? row.channel,
      sku: skuOf.get(row.master_product_id) ?? '',
      product: row.product_name,
      qty: row.qty,
      salePence: Number(row.sale_price_pence),
      perUnitPence: Number(row.price_per_unit_pence),
      revenuePence: Number(row.revenue_pence),
      productCostPence: Number(row.product_cost_pence),
      feesPence: Number(row.fees_pence),
      shippingPence: Number(row.shipping_pence),
      otherCostPence: Number(row.other_cost_pence),
      netProfitPence: Number(row.margin_pence),
      marginPercent: row.margin_percent === null ? null : Number(row.margin_percent),
    }
  })

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Checking</p>
      <h1 style={pageTitle}>Order lines</h1>
      <p style={pageIntro}>
        Every order line with its full cost breakdown, newest first. Useful for checking exactly how a margin was worked out.
        Tick lines and use Delete selected to remove test orders.
      </p>

      <div style={cardStyle}>
        <OrderLinesTable lines={lines} ranges={ranges} />
      </div>
    </div>
  )
}
