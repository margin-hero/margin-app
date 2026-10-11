import { marginTier, radius, type MarginRanges } from '@/lib/theme'

// A margin % in its red / amber / green tier (the tenant's cut-offs from /settings)
export default function MarginPill({ value, ranges, suffix = '' }: { value: number | null; ranges: MarginRanges; suffix?: string }) {
  const tier = marginTier(value, ranges)
  return (
    <span style={{ display: 'inline-block', minWidth: '64px', textAlign: 'center', fontSize: '13px', fontWeight: 800, padding: '3px 8px', borderRadius: radius, background: tier.bg, color: tier.fg, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {value === null ? '—' : `${value}%`}{suffix}
    </span>
  )
}
