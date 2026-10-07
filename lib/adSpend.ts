import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { fetchAll } from './fetchAll'

// Advertising spend (Amazon Sponsored Products so far), per store SKU per day, from the
// ad_spend_lines view. Like overheads it isn't in order_margins: pages take it off net profit
// at reporting time. cost_pence is the cost to the business (ex. VAT if the store was VAT
// registered on the day, inc. VAT if not); spend_pence is ex. VAT, as Amazon shows it.

export type AdSpendLine = {
  store_id: string
  master_product_id: string
  product_name: string
  standard_sku: string
  spend_date: string
  spend_pence: number
  cost_pence: number
  attributed_sales_pence: number
}

export type AdTotals = { costPence: number; spendPence: number; attributedSalesPence: number }

// Server pages pass their own client (createServerSupabase) as `db`
export async function loadAdSpend(range: { from: string; to: string } | null, db: SupabaseClient = supabase): Promise<AdSpendLine[]> {
  const { data } = await fetchAll((from, to) => {
    let q = db
      .from('ad_spend_lines')
      .select('store_id, master_product_id, product_name, standard_sku, spend_date, spend_pence, cost_pence, attributed_sales_pence')
    if (range) q = q.gte('spend_date', range.from).lte('spend_date', range.to)
    return q.order('id').range(from, to)
  })
  return ((data || []) as AdSpendLine[]).map((r) => ({
    ...r,
    spend_pence: Number(r.spend_pence) || 0,
    cost_pence: Number(r.cost_pence) || 0,
    attributed_sales_pence: Number(r.attributed_sales_pence) || 0,
  }))
}

// Sums the lines by a key, e.g. store, or product × store
export function sumAdSpend(lines: AdSpendLine[], key: (l: AdSpendLine) => string): Map<string, AdTotals> {
  const totals = new Map<string, AdTotals>()
  for (const l of lines) {
    const k = key(l)
    const t = totals.get(k) || { costPence: 0, spendPence: 0, attributedSalesPence: 0 }
    t.costPence += l.cost_pence
    t.spendPence += l.spend_pence
    t.attributedSalesPence += l.attributed_sales_pence
    totals.set(k, t)
  }
  return totals
}

// ACOS = ad spend ÷ the sales the ads brought in (both as Amazon shows them: spend ex. VAT,
// sales at the price the customer paid). null when there were no ad sales.
export function acosPercent(t: AdTotals | undefined): number | null {
  if (!t || t.attributedSalesPence <= 0) return null
  return Math.round((t.spendPence / t.attributedSalesPence) * 1000) / 10
}

// TACOS = ad spend ÷ ALL sales (what customers paid, so it compares like for like with ACOS)
export function tacosPercent(t: AdTotals | undefined, grossSalesPence: number): number | null {
  if (!t || grossSalesPence <= 0) return null
  return Math.round((t.spendPence / grossSalesPence) * 1000) / 10
}
