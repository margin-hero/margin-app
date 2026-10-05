import { lime, display } from '@/lib/theme'

// The Margin Hero mark (from public/brand/margin-hero-mark.svg), drawn inline so it
// stays sharp at any size. `size` = height and width in px.
export function LogoMark({ size }: { size: number }) {
  return (
    <svg viewBox="8 8 48 48" width={size} height={size} aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      <g fill="none" stroke={lime} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 48 V20 L30 38 L49 17" />
        <path d="M37 16 H50 V26" />
        <path d="M50 37 V48" />
      </g>
    </svg>
  )
}

// Mark + "Margin Hero" wordmark, in the proportions of public/brand/margin-hero-logo.svg
// (text = 0.625 × mark height). The wordmark is real text so it uses the site's Mona Sans;
// `showText` = false shows the mark only (collapsed sidebar).
export default function Logo({ size, showText = true }: { size: number; showText?: boolean }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: `${Math.round(size * 0.21)}px` }}>
      <LogoMark size={size} />
      {showText && <span style={{ ...display, fontSize: `${Math.round(size * 0.625)}px`, lineHeight: 1 }}>Margin Hero</span>}
    </span>
  )
}
