import { connection } from 'next/server'
import Link from 'next/link'
import { loadMarginRanges } from '@/lib/marginRanges'
import { loadSkuStoreMargins, cellPercent, cellPerUnitPence, MarginCell } from '@/lib/skuStoreMargins'
import { pounds } from '@/lib/format'
import { lime, bg, border, amber, green, red, muted, dim, text, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, inputStyle, primaryButton, marginTier, marginLegend } from '@/lib/theme'

const iso = (d: Date) => d.toISOString().slice(0, 10)

// Quick periods. Quarters are calendar quarters (Jan–Mar, Apr–Jun, ...).
const PERIODS: { key: string; label: string; range: () => { from: string; to: string } | null }[] = [
  { key: 'all', label: 'All time', range: () => null },
  { key: 'ytd', label: 'YTD', range: () => ({ from: `${new Date().getUTCFullYear()}-01-01`, to: iso(new Date()) }) },
  {
    key: 'quarter', label: 'This quarter', range: () => {
      const now = new Date()
      return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (now.getUTCMonth() % 3), 1))), to: iso(now) }
    },
  },
  {
    key: 'last-quarter', label: 'Last quarter', range: () => {
      const now = new Date()
      const start = now.getUTCMonth() - (now.getUTCMonth() % 3)
      return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), start - 3, 1))), to: iso(new Date(Date.UTC(now.getUTCFullYear(), start, 0))) }
    },
  },
  ...[30, 90].map((n) => ({
    key: `${n}d`, label: `${n}D`, range: () => {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - (n - 1))
      return { from: iso(d), to: iso(new Date()) }
    },
  })),
]

export default async function MarginsPage({ searchParams }: PageProps<'/margins'>) {
  // Render on every visit so the page shows live data, not a snapshot from build time
  await connection()
  const params = await searchParams
  const get = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '')

  const includeOverheads = get('overheads') === '1'
  const perUnit = get('per') !== 'total' // £ per unit sold (default) or total £ for the period
  const sort = get('sort') || 'name' // 'name', 'all' or a store id
  const by = get('by') === 'gbp' ? 'gbp' : 'pct'
  const dir = get('dir') === 'asc' ? 'asc' : 'desc'

  const custom = get('period') === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(get('from')) && /^\d{4}-\d{2}-\d{2}$/.test(get('to'))
  const period = custom ? null : PERIODS.find((p) => p.key === get('period')) ?? PERIODS[0]
  const range = custom ? { from: get('from'), to: get('to') } : period!.range()

  const ranges = await loadMarginRanges()
  const legend = marginLegend(ranges)
  const result = await loadSkuStoreMargins(includeOverheads, range)
  if ('error' in result) {
    return <div style={{ ...pageStyle, color: red }}>Error: {result.error}</div>
  }
  const { stores, overheadNote, cell, total, notListed } = result

  // Links keep every other setting and change just the ones given
  const current: Record<string, string> = {
    period: custom ? 'custom' : period!.key, from: custom ? range!.from : '', to: custom ? range!.to : '',
    overheads: includeOverheads ? '1' : '', per: perUnit ? '' : 'total', sort: sort === 'name' ? '' : sort, by: by === 'pct' ? '' : by, dir: dir === 'desc' ? '' : dir,
  }
  const href = (changes: Record<string, string>) => {
    const merged = { ...current, ...changes }
    if (merged.period === 'all') merged.period = ''
    const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v)).toString()
    return qs ? `/margins?${qs}` : '/margins'
  }

  const profitPence = (c: MarginCell | null) => (perUnit ? cellPerUnitPence(c) : c ? Math.round(c.marginPence) : null)
  const sortValue = (c: MarginCell | null) => (by === 'pct' ? cellPercent(c) : profitPence(c))

  // Sort rows: by name, or by one column's % or £. Products with no figure go to the bottom.
  const products = [...result.products]
  if (sort !== 'name') {
    const value = (productId: string) => sortValue(sort === 'all' ? total(productId) : cell(productId, sort))
    products.sort((a, b) => {
      const va = value(a.id)
      const vb = value(b.id)
      if (va === null || vb === null) return va === null ? (vb === null ? a.name.localeCompare(b.name) : 1) : -1
      return dir === 'desc' ? vb - va : va - vb
    })
  }

  const pill = (on: boolean): React.CSSProperties => ({ fontSize: '12px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px', textDecoration: 'none', background: on ? lime : 'transparent', color: on ? bg : muted, border: `1px solid ${on ? lime : border}` })
  const headStyle: React.CSSProperties = { fontSize: '12px', color: muted, fontWeight: 600, padding: '4px', textAlign: 'center', verticalAlign: 'bottom' }
  const cellStyle = (bgColour: string, fg: string, outlined = false): React.CSSProperties => ({
    background: bgColour,
    color: fg,
    textAlign: 'center',
    fontSize: '16px',
    fontWeight: 800,
    padding: '10px 6px',
    borderRadius: '10px',
    outline: outlined ? `2px solid ${fg}` : 'none',
    outlineOffset: '-2px',
  })

  // "% ↓  £ ↓" sort links under a column heading; clicking the active one flips the direction
  const sortLinks = (column: string) => (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '4px' }}>
      {(['pct', 'gbp'] as const).map((b) => {
        const on = sort === column && by === b
        return (
          <Link key={b} href={href({ sort: column, by: b === 'pct' ? '' : b, dir: on && dir === 'desc' ? 'asc' : '' })} style={{ color: on ? lime : dim, textDecoration: 'none', fontWeight: 700 }}>
            {b === 'pct' ? '%' : '£'}{on ? (dir === 'desc' ? ' ↓' : ' ↑') : ''}
          </Link>
        )
      })}
    </div>
  )

  const figureCell = (key: string, c: MarginCell | null, outlined: boolean) => {
    const m = cellPercent(c)
    const gbp = profitPence(c)
    const tier = marginTier(m, ranges)
    return (
      <td key={key} style={cellStyle(tier.bg, tier.fg, outlined)}>
        {m === null ? '—' : `${m}%`}
        {gbp !== null && <div style={{ fontSize: '12px', fontWeight: 600, color: text, marginTop: '2px' }}>{pounds(gbp)}</div>}
      </td>
    )
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Dashboards</p>
      <h1 style={pageTitle}>Margins</h1>
      <p style={pageIntro}>Net margin % and net profit £ for every product in every store, side by side.</p>

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {PERIODS.map((p) => (
          <Link key={p.key} href={href({ period: p.key, from: '', to: '' })} style={pill(!custom && period!.key === p.key)}>{p.label}</Link>
        ))}
        <form action="/margins" method="get" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {Object.entries(current).filter(([k, v]) => v && !['period', 'from', 'to'].includes(k)).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="period" value="custom" />
          <input type="date" name="from" defaultValue={range?.from ?? ''} required style={inputStyle} aria-label="From" />
          <span style={{ color: muted, fontSize: '13px' }}>to</span>
          <input type="date" name="to" defaultValue={range?.to ?? ''} required style={inputStyle} aria-label="To" />
          <button type="submit" style={primaryButton}>Update</button>
        </form>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Link href={href({ overheads: '' })} style={pill(!includeOverheads)}>Before overheads</Link>
        <Link href={href({ overheads: '1' })} style={pill(includeOverheads)}>After overheads</Link>
        <span style={{ width: '12px' }} />
        <Link href={href({ per: '' })} style={pill(perUnit)}>£ per unit</Link>
        <Link href={href({ per: 'total' })} style={pill(!perUnit)}>£ total</Link>
        {overheadNote && <span style={{ fontSize: '12px', color: muted }}>{overheadNote}</span>}
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }}>
          <p style={{ ...cardTitle, margin: 0 }}>
            Net margin % and net profit {perUnit ? 'per unit' : 'total'}{includeOverheads ? ' after overheads' : ''} · {range ? `${range.from} to ${range.to}` : 'all time'}
          </p>
          <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: muted }}>
            <span><span style={{ color: red }}>●</span> {legend[0]}</span>
            <span><span style={{ color: amber }}>●</span> {legend[1]}</span>
            <span><span style={{ color: green }}>●</span> {legend[2]}</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: '6px', width: '100%', minWidth: `${280 + stores.length * 120}px` }}>
            <thead>
              <tr>
                <th style={{ ...headStyle, textAlign: 'left' }}>
                  <Link href={href({ sort: '', by: '', dir: '' })} style={{ color: sort === 'name' ? lime : muted, textDecoration: 'none' }}>SKU · Product{sort === 'name' ? ' (A–Z)' : ''}</Link>
                </th>
                <th style={{ ...headStyle, color: text }}>All stores{sortLinks('all')}</th>
                {stores.map((store) => (
                  <th key={store.id} style={headStyle}>
                    <div style={{ color: text, fontWeight: 800 }}>{store.platform || store.name}</div>
                    {store.platform && <div>{store.name}</div>}
                    {sortLinks(store.id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const known = stores.map((store) => cellPercent(cell(product.id, store.id))).filter((m): m is number => m !== null)
                const best = known.length > 1 ? Math.max(...known) : null
                return (
                  <tr key={product.id}>
                    <td style={{ padding: '4px', fontSize: '15px', fontWeight: 800, color: text }}>
                      {product.sku && <span style={{ color: muted, fontWeight: 700, marginRight: '8px' }}>{product.sku}</span>}
                      {product.name}
                    </td>
                    {figureCell('all', total(product.id), false)}
                    {stores.map((store) => {
                      if (notListed(product.id, store.id)) {
                        return (
                          <td key={store.id} style={{ ...cellStyle('transparent', dim), border: `1px dashed ${border}`, fontSize: '12px', fontWeight: 600 }}>Not listed</td>
                        )
                      }
                      const c = cell(product.id, store.id)
                      const m = cellPercent(c)
                      return figureCell(store.id, c, m !== null && m === best)
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: '12px', color: dim, margin: '12px 0 0' }}>
          Each cell: net margin % (total profit ÷ total revenue for the period) over net profit £ {perUnit ? 'per unit sold' : 'for the period'}. Click % or £ under a column to sort.
          Outlined cell = the most profitable store for that product. — = listed, no sales in this period. Not listed = not mapped in that store (see <Link href="/opportunities" style={{ color: muted }}>Opportunities</Link>).
        </p>
      </div>
    </div>
  )
}
