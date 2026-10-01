import { supabase } from './supabase'

// Courier price list + shipping profiles. See the shipping_profiles migration for the model.

export type CourierPrice = { id: string; courier_service_id: string; price_pence: number; effective_from: string }
export type CourierService = { id: string; name: string; vat_rate: number; courier_service_prices: CourierPrice[] }
export type ProfileBand = { id: string; shipping_profile_id: string; min_qty: number; max_qty: number | null; courier_service_id: string; parcels: number }
export type ShippingProfile = { id: string; name: string; shipping_profile_bands: ProfileBand[] }

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function testTenantId(): Promise<string | null> {
  const { data } = await supabase.from('tenants').select('id').eq('name', 'Test Store').single()
  return data?.id ?? null
}

export async function loadCourierServices(): Promise<CourierService[]> {
  const { data } = await supabase
    .from('courier_services')
    .select('id, name, vat_rate, courier_service_prices(id, courier_service_id, price_pence, effective_from)')
    .order('name')
  return ((data as CourierService[]) || []).map((s) => ({
    ...s,
    courier_service_prices: [...s.courier_service_prices].sort((a, b) => a.effective_from.localeCompare(b.effective_from)),
  }))
}

export async function loadShippingProfiles(): Promise<ShippingProfile[]> {
  const { data } = await supabase
    .from('shipping_profiles')
    .select('id, name, shipping_profile_bands(id, shipping_profile_id, min_qty, max_qty, courier_service_id, parcels)')
    .order('name')
  return ((data as ShippingProfile[]) || []).map((p) => ({
    ...p,
    shipping_profile_bands: [...p.shipping_profile_bands].sort((a, b) => a.min_qty - b.min_qty),
  }))
}

// The price in effect on a date (same rule as the margin view: latest effective_from <= date)
export function priceOn(service: CourierService | undefined, date: string): CourierPrice | null {
  if (!service) return null
  let found: CourierPrice | null = null
  for (const p of service.courier_service_prices) if (p.effective_from <= date) found = p
  return found
}

export function bandLabel(b: { min_qty: number; max_qty: number | null }): string {
  if (b.max_qty === null) return `${b.min_qty}+`
  return b.min_qty === b.max_qty ? `${b.min_qty}` : `${b.min_qty}–${b.max_qty}`
}

// Plain-English warnings about a profile's bands: quantities with no band, or overlaps
export function bandWarnings(bands: ProfileBand[]): string[] {
  const sorted = [...bands].sort((a, b) => a.min_qty - b.min_qty)
  const warnings: string[] = []
  let next = 1
  for (const b of sorted) {
    if (b.min_qty > next) warnings.push(`Quantity ${next === b.min_qty - 1 ? next : `${next}–${b.min_qty - 1}`} has no band, so those orders get no shipping cost.`)
    if (b.min_qty < next) warnings.push(`Band ${bandLabel(b)} overlaps an earlier band.`)
    if (b.max_qty === null) return warnings
    next = Math.max(next, b.max_qty + 1)
  }
  if (sorted.length) warnings.push(`Quantities of ${next} and above have no band. Make the last band "and above" (leave max empty) to cover them.`)
  return warnings
}

export function overlapsExisting(bands: ProfileBand[], minQty: number, maxQty: number | null, ignoreId?: string): boolean {
  const hi = maxQty ?? Infinity
  return bands.some((b) => b.id !== ignoreId && minQty <= (b.max_qty ?? Infinity) && b.min_qty <= hi)
}
