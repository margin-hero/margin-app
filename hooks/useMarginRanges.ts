'use client'

import { useEffect, useState } from 'react'
import { loadMarginRanges } from '@/lib/marginRanges'
import { DEFAULT_MARGIN_RANGES, MarginRanges } from '@/lib/theme'

// For client pages: the tenant's margin colour ranges (defaults until loaded)
export function useMarginRanges(): MarginRanges {
  const [ranges, setRanges] = useState<MarginRanges>(DEFAULT_MARGIN_RANGES)
  useEffect(() => {
    loadMarginRanges().then(setRanges)
  }, [])
  return ranges
}
