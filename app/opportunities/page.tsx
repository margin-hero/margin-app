import { connection } from 'next/server'
import { loadMarginRanges } from '@/lib/marginRanges'
import { loadSkuStoreMargins, cellPercent } from '@/lib/skuStoreMargins'
import { pounds } from '@/lib/format'
import { red, muted, dim, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, thStyle, tdStyle, marginTier } from '@/lib/theme'

export default async function OpportunitiesPage() {
  // Render on every visit so the list shows live data, not a snapshot from build time
  await connection()
  const ranges = await loadMarginRanges()

  // Before overheads: overheads are mostly fixed, so listing in another store doesn't add to them
  const result = await loadSkuStoreMargins(false)
  if ('error' in result) {
    return <div style={{ ...pageStyle, color: red }}>Error: {result.error}</div>
  }
  const { products, stores, cell, total, notListed } = result

  // "OnBuy · Arkmat": channel first, then the store name
  const storeName = (store: { name: string; platform: string }) => (store.platform ? `${store.platform} · ${store.name}` : store.name)

  // Products making a profit somewhere that aren't listed in every store yet, best margin first
  const opportunities = products
    .map((product) => {
      let best: { margin: number; store: string } | null = null
      for (const store of stores) {
        const m = cellPercent(cell(product.id, store.id))
        if (m !== null && (best === null || m > best.margin)) best = { margin: m, store: storeName(store) }
      }
      const missing = stores.filter((store) => notListed(product.id, store.id)).map(storeName)
      const profitPence = Math.round(total(product.id)?.marginPence ?? 0)
      return { ...product, best, missing, profitPence }
    })
    .filter((o) => o.best !== null && o.best.margin > 0 && o.missing.length > 0)
    .sort((a, b) => b.best!.margin - a.best!.margin)

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Dashboards</p>
      <h1 style={pageTitle}>Listing opportunities</h1>
      <p style={pageIntro}>
        Products making a profit in one store that aren&apos;t listed in your other stores yet, best margin first.
      </p>

      <div style={cardStyle}>
        <p style={{ ...cardTitle, margin: '0 0 4px' }}>Not listed yet</p>
        <p style={{ fontSize: '13px', color: muted, margin: '0 0 18px' }}>
          Net margin before overheads, all time. Fees and shipping differ by store, so check the numbers before listing. Only stores with at least one mapped product are checked.
        </p>
        {opportunities.length === 0 ? (
          <p style={{ fontSize: '14px', color: dim, margin: 0 }}>No gaps: every profitable product is listed in every store.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU · Product</th>
                  <th style={thStyle}>Best margin</th>
                  <th style={thStyle}>Net profit so far</th>
                  <th style={thStyle}>Not listed in</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o) => (
                  <tr key={o.id}>
                    <td style={{ ...tdStyle, fontWeight: 800 }}>{o.sku && <span style={{ color: muted, fontWeight: 700, marginRight: '8px' }}>{o.sku}</span>}{o.name}</td>
                    <td style={tdStyle}>
                      <span style={{ color: marginTier(o.best!.margin, ranges).fg, fontWeight: 800 }}>{o.best!.margin}%</span>
                      <span style={{ color: muted }}> on {o.best!.store}</span>
                    </td>
                    <td style={tdStyle}>{pounds(o.profitPence)}</td>
                    <td style={tdStyle}>{o.missing.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
