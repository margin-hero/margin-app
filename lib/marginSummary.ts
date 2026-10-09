import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

// The dashboards' totals, added up in the database by margin_summary()
// (20261009140000_margin_summary.sql): one row per store × product × store SKU × month ×
// sale/refund, instead of every line from margin_lines. Refund rows are negative, as in
// margin_lines. Sums only: work percentages out from the totals, never average them.

export type SummaryRow = {
  store_id: string
  master_product_id: string
  platform_listing_id: string
  product_name: string
  channel: string // the store's name
  line_type: 'sale' | 'refund'
  month: string // "2026-08"
  first_date: string
  last_date: string
  lines: number // sale lines = orders
  effective_qty: number
  refunded_units: number
  revenue_pence: number
  product_cost_pence: number
  total_cost_pence: number
  margin_pence: number
  gross_sales_pence: number
}

// null dates = no limit (all time)
export async function loadMarginSummary(
  range: { from: string; to: string } | null,
  db: SupabaseClient = supabase
): Promise<{ data: SummaryRow[]; error: { message: string } | null }> {
  const { data, error } = await db.rpc('margin_summary', { date_from: range?.from ?? null, date_to: range?.to ?? null })
  if (error) return { data: [], error }
  // Sums arrive as JSON numbers (or strings for very large numerics): make sure they're numbers
  const rows = ((data || []) as Record<string, unknown>[]).map((r) => ({
    ...r,
    lines: Number(r.lines),
    effective_qty: Number(r.effective_qty),
    refunded_units: Number(r.refunded_units),
    revenue_pence: Number(r.revenue_pence),
    product_cost_pence: Number(r.product_cost_pence),
    total_cost_pence: Number(r.total_cost_pence),
    margin_pence: Number(r.margin_pence),
    gross_sales_pence: Number(r.gross_sales_pence),
  })) as SummaryRow[]
  return { data: rows, error: null }
}
