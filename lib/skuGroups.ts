// Spotting store SKUs that are probably the same product, for /tidy-products.
// Only general rules that apply to any seller's SKUs, never anything product-specific:
// - capitals and separators don't matter: "1+Ameobic+12mm+Floor", "1_ameobic_12mm_floor"
//   and "1-Ameobic-12mm-Floor" are the same
// - an FBA copy is the same product: "LL-1-FBA" / "LL-1FBA" = "LL-1"
// - Amazon Grade & Resell (resale) SKUs wrap the original: "amzn.gr.LL-1-oAmPMm7...-LN" = "LL-1"
// They're only suggestions: the seller always decides.

export function skuGroupKey(sku: string): string {
  let s = (sku || '').trim()
  const resale = s.match(/^amzn\.gr\.(.+?)-\w{10,}(?:-[A-Za-z]{2})?$/i)
  if (resale) s = resale[1]
  return s
    .toLowerCase()
    .replace(/[\s+_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-?fba$/, '')
}

// The best product SKU to suggest for a group: a product that already has costs set up
// (so they're kept), then a "clean" SKU (no FBA / resale / odd separators), then the one
// used by the most store SKUs, then A-Z.
export function suggestProductSku(
  members: { productSku: string; productHasCosts: boolean }[]
): string {
  const tally = new Map<string, { count: number; hasCosts: boolean }>()
  for (const m of members) {
    const t = tally.get(m.productSku) ?? { count: 0, hasCosts: false }
    t.count++
    t.hasCosts = t.hasCosts || m.productHasCosts
    tally.set(m.productSku, t)
  }
  const messy = (sku: string) => (/^amzn\.gr\./i.test(sku) ? 2 : 0) + (/fba$/i.test(sku) ? 1 : 0) + (/[\s+_]/.test(sku) ? 1 : 0)
  return Array.from(tally.entries()).sort(([a, ta], [b, tb]) =>
    Number(tb.hasCosts) - Number(ta.hasCosts) || messy(a) - messy(b) || tb.count - ta.count || a.localeCompare(b)
  )[0][0]
}
