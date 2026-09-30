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
