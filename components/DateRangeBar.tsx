'use client'

import { lime, bg, muted, border, inputStyle, primaryButton, radius } from '@/lib/theme'

const PRESETS = [7, 30, 90]

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - (n - 1))
  return d.toISOString().slice(0, 10)
}
const today = () => new Date().toISOString().slice(0, 10)

// Quick 7D / 30D / 90D pills plus custom From / To dates. Presets apply immediately;
// custom dates apply when Update is clicked.
export default function DateRangeBar({ from, to, onChange, onApply }: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  onApply: (from: string, to: string) => void
}) {
  const activePreset = to === today() ? PRESETS.find((n) => from === daysAgo(n)) : undefined

  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '20px' }}>
      {PRESETS.map((n) => {
        const on = activePreset === n
        return (
          <button
            key={n}
            onClick={() => { onChange(daysAgo(n), today()); onApply(daysAgo(n), today()) }}
            style={{ fontSize: '12px', fontWeight: 700, padding: '7px 14px', borderRadius: radius, cursor: 'pointer', background: on ? lime : 'transparent', color: on ? bg : muted, border: `1px solid ${on ? lime : border}` }}
          >
            {n}D
          </button>
        )
      })}
      <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} style={inputStyle} aria-label="From" />
      <span style={{ color: muted, fontSize: '13px' }}>to</span>
      <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} style={inputStyle} aria-label="To" />
      <button onClick={() => onApply(from, to)} style={primaryButton}>Update</button>
    </div>
  )
}
