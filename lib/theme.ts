import type { CSSProperties } from 'react'

// Brand palette, shared by the homepage and the app.
// Lime + near-black/olive greys, with bright red / green for losing / winning margin.
export const lime = '#D2FF00'
export const green = '#39FF6A'
export const red = '#FF4C4C'
export const amber = '#FFB020'
export const bg = '#111112'
export const panel = '#1B1C19'
export const panelRaised = '#23251F'
export const border = '#2E3029'
export const text = '#EBEEE0'
export const muted = '#9A9D8F'
export const dim = '#5E6158'

export const font = 'var(--font-mona), Arial, sans-serif'
// Extra-wide, extra-heavy cut of Mona Sans for headlines
export const display: CSSProperties = { fontFamily: font, fontStretch: '125%', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.01em' }

// ---- Shared app page styles ----

export const pageStyle: CSSProperties = { background: bg, minHeight: '100vh', padding: 'clamp(20px, 3vw, 40px)', fontFamily: font, color: text }
export const eyebrow: CSSProperties = { fontSize: '12px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: lime, margin: '0 0 10px' }
export const pageTitle: CSSProperties = { ...display, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 0.95, margin: '0 0 10px' }
export const pageIntro: CSSProperties = { fontSize: '15px', color: muted, margin: 0, maxWidth: '720px', lineHeight: 1.5 }
export const cardStyle: CSSProperties = { background: panel, border: `1px solid ${border}`, borderRadius: '16px', padding: '22px', marginTop: '20px' }
export const cardTitle: CSSProperties = { fontSize: '13px', fontWeight: 600, color: muted, margin: '0 0 18px', textTransform: 'uppercase', letterSpacing: '0.06em' }
export const thStyle: CSSProperties = { padding: '8px', textAlign: 'left', color: muted, fontWeight: 600, fontSize: '12px', borderBottom: `1px solid ${border}` }
export const tdStyle: CSSProperties = { padding: '10px 8px', color: text, fontSize: '14px', borderBottom: `1px solid ${border}` }
export const inputStyle: CSSProperties = { padding: '9px 14px', background: bg, color: text, border: `1px solid ${border}`, borderRadius: '999px', fontFamily: font, fontSize: '14px' }
export const primaryButton: CSSProperties = { background: lime, color: bg, border: 'none', borderRadius: '999px', padding: '9px 20px', fontSize: '13px', fontWeight: 800, fontFamily: font, textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer' }
export const linkButton: CSSProperties = { color: lime, border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 700, fontFamily: font }

// Margin % colour tiers (red / amber / green). The cut-offs are a tenant setting
// (tenants.margin_red_below / margin_green_from, edited on /settings); these are the defaults.
// Lime is kept for the brand accent only, never for margin.
export type MarginRanges = { redBelow: number; greenFrom: number }
export const DEFAULT_MARGIN_RANGES: MarginRanges = { redBelow: 10, greenFrom: 20 }

export function marginTier(margin: number | null, ranges: MarginRanges = DEFAULT_MARGIN_RANGES) {
  if (margin === null) return { bg: 'transparent', fg: dim }
  if (margin < ranges.redBelow) return { bg: 'rgba(255,76,76,0.16)', fg: red }
  if (margin < ranges.greenFrom) return { bg: 'rgba(255,176,32,0.15)', fg: amber }
  return { bg: 'rgba(57,255,106,0.16)', fg: green }
}

// Legend text, e.g. ['under 10%', '10–20%', '20%+']
export function marginLegend(ranges: MarginRanges = DEFAULT_MARGIN_RANGES): [string, string, string] {
  const f = (n: number) => `${Number(n.toFixed(1))}%`
  return [`under ${f(ranges.redBelow)}`, `${f(ranges.redBelow)}–${f(ranges.greenFrom)}`, `${f(ranges.greenFrom)}+`]
}
