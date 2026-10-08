import Link from 'next/link'
import { connection } from 'next/server'
import { createServerSupabase } from '@/lib/supabaseServer'
import { fetchAll } from '@/lib/fetchAll'
import { loadMarginRanges } from '@/lib/marginRanges'
import { loadStores } from '@/lib/stores'
import { lime, bg, border, muted, red, radius, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, inputStyle, primaryButton } from '@/lib/theme'
import OrderLinesTable, { OrderLine } from './OrderLinesTable'

// Lines shown at once. The margin calculation (margin_lines) is the slow part, so the page
// first finds which lines to show from the plain tables, then works out only those.
const LIMIT = 200
// Multi-item orders are looked for among this many of the newest sales
const MULTI_SCAN = 5000

const VIEWS = [
  { key: 'latest', label: 'Latest' },
  { key: 'multi', label: 'Multi-item orders' },
  { key: 'refunds', label: 'Refunds' },
] as const

type Found = { id: string; orderRef: string; date: string; isRefund: boolean }

// Unlisted page (not in the sidebar): order lines with their full cost breakdown, for
// checking calculations while testing. Customers use /margins instead.
export default async function OrderLinesPage({ searchParams }: PageProps<'/order-lines'>) {
  // Render on every visit so this shows live data, not a snapshot from build time
  await connection()
  const params = await searchParams
  const get = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '')
  // Order numbers and SKUs only: other characters would break the database filter
  const q = get('q').trim().replace(/[^\w\-. ]/g, '').slice(0, 60)
  const view = VIEWS.find((v) => v.key === get('view'))?.key ?? 'latest'

  const db = await createServerSupabase()
  const [stores, ranges] = await Promise.all([loadStores(db), loadMarginRanges(db)])

  // 1. Which lines to show (sales from order_line_items, refunds from order_refunds)
  let found: Found[] = []
  let error: string | null = null
  const sale = (r: { id: string; external_id: string; order_date: string }): Found => ({ id: r.id, orderRef: r.external_id, date: r.order_date, isRefund: false })
  const refund = (r: { id: string; original_external_id: string | null; refund_date: string }): Found => ({ id: r.id, orderRef: r.original_external_id ?? '', date: r.refund_date, isRefund: true })

  if (q) {
    // An order number, or a store SKU / your SKU
    const [{ data: listings, error: e1 }, { data: products, error: e2 }] = await Promise.all([
      db.from('platform_listings').select('id').ilike('platform_sku', `%${q}%`).limit(300),
      db.from('master_products').select('id').ilike('standard_sku', `%${q}%`).limit(100),
    ])
    let listingIds = (listings ?? []).map((l) => l.id as string)
    if (products?.length) {
      const { data: more } = await db.from('platform_listings').select('id').in('master_product_id', products.map((p) => p.id)).limit(300)
      listingIds = Array.from(new Set([...listingIds, ...(more ?? []).map((l) => l.id as string)])).slice(0, 300)
    }
    const listingFilter = listingIds.length ? `,platform_listing_id.in.(${listingIds.join(',')})` : ''
    const [sales, refunds] = await Promise.all([
      db.from('order_line_items').select('id, external_id, order_date').or(`external_id.ilike.*${q}*${listingFilter}`).order('order_date', { ascending: false }).limit(LIMIT),
      db.from('order_refunds').select('id, original_external_id, refund_date').or(`original_external_id.ilike.*${q}*${listingFilter}`).order('refund_date', { ascending: false }).limit(LIMIT),
    ])
    error = e1?.message || e2?.message || sales.error?.message || refunds.error?.message || null
    found = [...(sales.data ?? []).map(sale), ...(refunds.data ?? []).map(refund)]
  } else if (view === 'multi') {
    // Orders with more than one line in the same store, among the newest sales
    const [{ data: listings, error: e1 }, { data: recent, error: e2 }] = await Promise.all([
      fetchAll((from, to) => db.from('platform_listings').select('id, store_id').order('id').range(from, to)),
      fetchAll((from, to) =>
        from >= MULTI_SCAN
          ? Promise.resolve({ data: [], error: null })
          : db.from('order_line_items').select('id, external_id, order_date, platform_listing_id').order('order_date', { ascending: false }).order('id').range(from, to)
      ),
    ])
    error = e1?.message || e2?.message || null
    const storeOfListing = new Map((listings ?? []).map((l) => [l.id as string, l.store_id as string]))
    const groups = new Map<string, Found[]>()
    for (const r of recent ?? []) {
      const key = `${storeOfListing.get(r.platform_listing_id)}|${r.external_id}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(sale(r))
    }
    for (const lines of groups.values()) {
      if (lines.length > 1 && found.length < LIMIT) found.push(...lines)
    }
  } else {
    const [sales, refunds] = await Promise.all([
      view === 'refunds'
        ? Promise.resolve({ data: [], error: null })
        : db.from('order_line_items').select('id, external_id, order_date').order('order_date', { ascending: false }).limit(LIMIT),
      db.from('order_refunds').select('id, original_external_id, refund_date').order('refund_date', { ascending: false }).limit(LIMIT),
    ])
    error = sales.error?.message || refunds.error?.message || null
    found = [...(sales.data ?? []).map(sale), ...(refunds.data ?? []).map(refund)]
  }

  // Newest first; an order's lines together, its sale before its refunds
  found.sort((a, b) => b.date.localeCompare(a.date) || a.orderRef.localeCompare(b.orderRef) || Number(a.isRefund) - Number(b.isRefund))
  const moreThanShown = found.length > LIMIT
  found = found.slice(0, LIMIT)

  // 2. The full cost breakdown for just those lines (in small batches, to keep each request short)
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < found.length && !error; i += 100) {
    const { data, error: e } = await db.from('margin_lines').select('*').in('order_line_item_id', found.slice(i, i + 100).map((f) => f.id))
    if (e) error = e.message
    rows.push(...(data ?? []))
  }
  const productIds = Array.from(new Set(rows.map((r) => r.master_product_id as string)))
  const listingIds = Array.from(new Set(rows.map((r) => r.platform_listing_id as string).filter(Boolean)))
  const [{ data: products, error: productsError }, { data: listings, error: listingsError }] = await Promise.all([
    productIds.length ? db.from('master_products').select('id, standard_sku').in('id', productIds) : Promise.resolve({ data: [], error: null }),
    listingIds.length ? db.from('platform_listings').select('id, platform_sku').in('id', listingIds) : Promise.resolve({ data: [], error: null }),
  ])
  error = error || productsError?.message || listingsError?.message || null

  if (error) {
    return <div style={{ ...pageStyle, color: red }}>Error: {error}</div>
  }

  const skuOf = new Map((products ?? []).map((p) => [p.id, p.standard_sku as string]))
  const storeSkuOf = new Map((listings ?? []).map((l) => [l.id, l.platform_sku as string]))
  const storeOf = new Map(stores.map((s) => [s.id, s]))
  const rowOf = new Map(rows.map((r) => [`${r.line_type === 'refund'}|${r.order_line_item_id}`, r]))

  const lines: OrderLine[] = found.flatMap((f) => {
    const row = rowOf.get(`${f.isRefund}|${f.id}`)
    if (!row) return []
    const store = storeOf.get(row.store_id as string)
    return [{
      id: f.id,
      isRefund: f.isRefund,
      orderRef: f.orderRef,
      date: row.order_date as string,
      channel: store?.platforms?.name ?? '',
      store: store?.name ?? (row.channel as string),
      sku: skuOf.get(row.master_product_id as string) ?? '',
      storeSku: storeSkuOf.get(row.platform_listing_id as string) ?? '',
      product: row.product_name as string,
      qty: Number(row.qty),
      salePence: Number(row.sale_price_pence),
      perUnitPence: row.price_per_unit_pence === null ? null : Number(row.price_per_unit_pence),
      revenuePence: Number(row.revenue_pence),
      productCostPence: Number(row.product_cost_pence),
      feesPence: Number(row.fees_pence),
      shippingPence: Number(row.shipping_pence),
      shippingSource: (row.shipping_source as string | null) ?? null,
      otherCostPence: Number(row.other_cost_pence),
      netProfitPence: Number(row.margin_pence),
      marginPercent: row.margin_percent === null ? null : Number(row.margin_percent),
    }]
  })

  const pill = (on: boolean): React.CSSProperties => ({ fontSize: '12px', fontWeight: 700, padding: '6px 14px', borderRadius: radius, textDecoration: 'none', background: on ? lime : 'transparent', color: on ? bg : muted, border: `1px solid ${on ? lime : border}` })
  const shown = q
    ? `${lines.length.toLocaleString('en-GB')} line(s) matching "${q}"`
    : view === 'multi'
      ? `${lines.length.toLocaleString('en-GB')} lines from orders with more than one line (newest ${MULTI_SCAN.toLocaleString('en-GB')} sales searched)`
      : `The newest ${lines.length.toLocaleString('en-GB')} ${view === 'refunds' ? 'refunds' : 'lines'}`

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Checking</p>
      <h1 style={pageTitle}>Order lines</h1>
      <p style={pageIntro}>
        Order lines with their full cost breakdown, for checking exactly how a margin was worked out. Search by order number or SKU,
        or click an order number to see all of that order&apos;s lines and refunds together.
        Refunds show as negative lines on their refund date (product cost negative = stock back on the shelf; shipping = return postage).
        Tick lines and use Delete selected to remove test orders.
      </p>

      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', margin: '0 0 14px' }}>
          <form action="/order-lines" method="get" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="search" name="q" defaultValue={q} placeholder="Order number or SKU" aria-label="Search by order number or SKU" style={{ ...inputStyle, width: '240px' }} />
            <button type="submit" style={primaryButton}>Search</button>
          </form>
          {VIEWS.map((v) => (
            <Link key={v.key} href={v.key === 'latest' ? '/order-lines' : `/order-lines?view=${v.key}`} style={pill(!q && view === v.key)}>{v.label}</Link>
          ))}
        </div>
        <p style={{ fontSize: '13px', color: muted, margin: '0 0 12px' }}>
          {shown}{moreThanShown ? `: only the newest ${LIMIT} are shown, so search to narrow it down` : ''}.
        </p>
        <OrderLinesTable lines={lines} ranges={ranges} />
      </div>
    </div>
  )
}
