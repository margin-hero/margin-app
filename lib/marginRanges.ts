import { supabase } from './supabase'
import { DEFAULT_MARGIN_RANGES, MarginRanges } from './theme'

// The tenant's red / amber / green cut-offs. Falls back to the defaults if the
// setting can't be read (e.g. before the migration has run).
export async function loadMarginRanges(): Promise<MarginRanges> {
  const { data } = await supabase.from('tenants').select('margin_red_below, margin_green_from').eq('name', 'Test Store').single()
  if (!data || data.margin_red_below == null || data.margin_green_from == null) return DEFAULT_MARGIN_RANGES
  return { redBelow: Number(data.margin_red_below), greenFrom: Number(data.margin_green_from) }
}
