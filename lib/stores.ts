import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

// A store is one shop on one platform, e.g. "TikTok – Brand A" or "Amazon FR".
// A tenant can have several stores on the same platform.
export type Store = {
  id: string
  tenant_id: string
  platform_id: string
  name: string
  vat_registered: boolean
  fulfilled_by_channel: boolean // the channel ships the orders (e.g. Amazon FBA): no shipping cost of your own
  platforms: { name: string; integration_type: string } | null
}

// Server pages pass their own client (createServerSupabase) as `db`
export async function loadStores(db: SupabaseClient = supabase): Promise<Store[]> {
  const { data } = await db
    .from('stores')
    .select('id, tenant_id, platform_id, name, vat_registered, fulfilled_by_channel, platforms(name, integration_type)')
    .order('name')
  return (data as any) || []
}

// How a store is shown in lists and dropdowns: "Brand A (TikTok)", or just "Amazon UK"
// when the store name already is (or contains) the platform name
export function storeLabel(store: { name: string; platforms: { name: string } | null } | undefined | null): string {
  if (!store) return '?'
  const platform = store.platforms?.name
  if (!platform || store.name.toLowerCase().includes(platform.toLowerCase())) return store.name
  return `${store.name} (${platform})`
}

// Channels whose reports show their own numeric SKU ID instead of your SKU. Each listing in
// these stores needs that ID too (saved in channel_sku_ids, per store), so sales can be matched.
const SKU_ID_CHANNELS = ['TikTok', 'Temu']

// e.g. 'Temu' for a Temu store, or null if the channel's reports use your own SKU
export function skuIdChannel(store: { platforms: { name: string } | null } | undefined | null): string | null {
  const platform = store?.platforms?.name
  return platform && SKU_ID_CHANNELS.includes(platform) ? platform : null
}

export function usesSkuIds(store: { platforms: { name: string } | null } | undefined | null): boolean {
  return skuIdChannel(store) !== null
}

// TikTok stores need a TikTok SKU ID on each listing (TikTok reports use numeric SKU IDs)
export function isTikTokStore(store: { platforms: { name: string } | null } | undefined | null): boolean {
  return store?.platforms?.name === 'TikTok'
}
