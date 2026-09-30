import { supabase } from './supabase'

// The fixed list of cost types (table cost_types, changed by migration only).
// basis: per_unit = multiplied by quantity; per_order = charged once per order line.
// in_gross: part of landed cost, so it counts in Gross Profit as well as Net.
export type CostType = {
  code: string
  label: string
  basis: 'per_unit' | 'per_order'
  in_gross: boolean
  sort_order: number
  description: string
}

export async function loadCostTypes(): Promise<CostType[]> {
  const { data } = await supabase.from('cost_types').select('*').order('sort_order')
  return (data as CostType[]) || []
}

// Entering an all-in landed cost AND its parts would count freight/duty twice
export const ALL_IN_LANDED = 'landed_cost_all_in'
export const LANDED_PARTS = ['cost_price', 'inbound_freight', 'import_duty']

export function hasDoubleCountRisk(activeCodes: Iterable<string>): boolean {
  const codes = new Set(activeCodes)
  return codes.has(ALL_IN_LANDED) && LANDED_PARTS.some((c) => codes.has(c))
}
