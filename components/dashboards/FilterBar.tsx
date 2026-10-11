'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import DateRangeBar from '@/components/DateRangeBar'
import { dashHref, type DashboardFilters } from '@/lib/dashboardFilters'
import { lime, bg, muted, border, inputStyle, radius } from '@/lib/theme'

// The shared filter bar for the drill-down dashboards. Every change goes into the URL
// (so links down a level, refresh and the back button all keep it), and the server page
// reloads its figures from there.
export default function FilterBar({ path, filters, stores, extra = {} }: {
  path: string // this page, e.g. '/dashboards/overview'
  filters: DashboardFilters
  stores: { id: string; label: string }[]
  extra?: Record<string, string> // the page's own settings (e.g. metric, sort), kept when a filter changes
}) {
  const router = useRouter()
  const [from, setFrom] = useState(filters.from)
  const [to, setTo] = useState(filters.to)
  const go = (changes: Partial<DashboardFilters>) => router.push(dashHref(path, filters, changes, extra))

  const toggle = (on: boolean, label: string, changes: Partial<DashboardFilters>, tip: string) => (
    <Link
      href={dashHref(path, filters, changes, extra)}
      title={tip}
      aria-pressed={on}
      style={{ fontSize: '12px', fontWeight: 700, padding: '7px 14px', borderRadius: radius, textDecoration: 'none', background: on ? lime : 'transparent', color: on ? bg : muted, border: `1px solid ${on ? lime : border}`, whiteSpace: 'nowrap' }}
    >
      {on ? '✓ ' : ''}{label}
    </Link>
  )

  return (
    <div>
      <DateRangeBar
        from={from}
        to={to}
        onChange={(f, t) => { setFrom(f); setTo(t) }}
        onApply={(f, t) => { if (f && t && f <= t) go({ from: f, to: t }) }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px', marginTop: '12px' }}>
      <select
        value={filters.store ?? ''}
        onChange={(e) => go({ store: e.target.value || null })}
        style={inputStyle}
        aria-label="Channel"
      >
        <option value="">All channels</option>
        {stores.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {toggle(filters.compare, 'vs prior period', { compare: !filters.compare }, 'Compare with the same number of days just before')}
        {toggle(filters.ads, 'Ads', { ads: !filters.ads }, 'Take ad spend off net profit')}
        {toggle(filters.overheads, 'Overheads', { overheads: !filters.overheads }, 'Take each sale\'s share of overheads off net profit')}
      </div>
      </div>
    </div>
  )
}
