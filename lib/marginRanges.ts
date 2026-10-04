import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { DEFAULT_MARGIN_RANGES, MarginRanges } from './theme'

// The tenant's red / amber / green cut-offs. Falls back to the defaults if the
// setting can't be read (e.g. before the migration has run).
// Server pages pass their own client (createServerSupabase) as `db`.
export async function loadMarginRanges(db: SupabaseClient = supabase): Promise<MarginRanges> {
  const { data } = await db.from('tenants').select('margin_red_below, margin_green_from').single() // RLS: only your own tenant is visible
  if (!data || data.margin_red_below == null || data.margin_green_from == null) return DEFAULT_MARGIN_RANGES
  return { redBelow: Number(data.margin_red_below), greenFrom: Number(data.margin_green_from) }
}
