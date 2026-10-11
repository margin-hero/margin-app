import type { ReactNode } from 'react'
import { panel, border, muted, text, font } from '@/lib/theme'

// One headline figure: label, big value, then a delta and / or a small note underneath
export default function KpiCard({ label, value, valueColor = text, children }: {
  label: string
  value: string
  valueColor?: string
  children?: ReactNode
}) {
  return (
    <div style={{ background: panel, border: `1px solid ${border}`, borderRadius: '16px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
      <div style={{ fontSize: '13px', color: muted }}>{label}</div>
      <div style={{ fontFamily: font, fontSize: '28px', fontWeight: 800, fontStretch: '110%', letterSpacing: '-0.01em', color: valueColor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={value}>{value}</div>
      {children && <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '2px' }}>{children}</div>}
    </div>
  )
}
