'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { loadStores, Store } from '@/lib/stores'

// Dropdown of the tenant's stores, narrowed to the platforms an importer understands
// (e.g. only TikTok stores on the TikTok import page).
export default function StorePicker({
  platformFilter,
  value,
  onChange,
}: {
  platformFilter: (platform: { name: string; integration_type: string }) => boolean
  value: Store | null
  onChange: (store: Store | null) => void
}) {
  const [stores, setStores] = useState<Store[] | null>(null)

  useEffect(() => {
    loadStores().then((all) => {
      const matching = all.filter((s) => s.platforms && platformFilter(s.platforms))
      setStores(matching)
      if (matching.length === 1) onChange(matching[0])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (stores === null) return <p>Loading stores...</p>

  if (stores.length === 0) {
    return (
      <p style={{ color: '#dc2626' }}>
        No stores set up for this platform yet. <Link href="/stores">Add one on the Stores page</Link> first.
      </p>
    )
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <label style={{ marginRight: '8px' }}>Store:</label>
      <select
        value={value?.id || ''}
        onChange={(e) => onChange(stores.find((s) => s.id === e.target.value) || null)}
        style={{ padding: '6px' }}
      >
        <option value="">Select...</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}{s.platforms && s.platforms.name !== s.name ? ` (${s.platforms.name})` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
