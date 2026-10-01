import { supabase } from './supabase'

// A store is one shop on one platform, e.g. "TikTok – Brand A" or "Amazon FR".
// A tenant can have several stores on the same platform.
export type Store = {
  id: string
  tenant_id: string
  platform_id: string
  name: string
  vat_registered: boolean
  platforms: { name: string; integration_type: string } | null
}

export async function loadStores(): Promise<Store[]> {
  const { data } = await supabase
    .from('stores')
    .select('id, tenant_id, platform_id, name, vat_registered, platforms(name, integration_type)')
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

// TikTok stores need a TikTok SKU ID on each listing (TikTok reports use numeric SKU IDs)
export function isTikTokStore(store: { platforms: { name: string } | null } | undefined | null): boolean {
  return store?.platforms?.name === 'TikTok'
}
