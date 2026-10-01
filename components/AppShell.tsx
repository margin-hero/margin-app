'use client'

import { usePathname } from 'next/navigation'
import Nav from '@/components/Nav'
import MissingCostsBanner from '@/components/MissingCostsBanner'
import { bg } from '@/lib/theme'

const DASHBOARDS = ['/grid', '/channel-overview', '/sku-detail', '/margins', '/trends']

// Public marketing pages: no sidebar
const PUBLIC_PAGES = ['/', '/pricing']

// Wraps every app page with the sidebar. Public pages are left as-is.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (PUBLIC_PAGES.includes(pathname)) return <>{children}</>

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: bg }}>
      <Nav />
      <main style={{ flex: 1, minWidth: 0 }}>
        {/* key = re-check on every dashboard visit, so it clears once costs are fixed */}
        {DASHBOARDS.includes(pathname) && <MissingCostsBanner key={pathname} />}
        {children}
      </main>
    </div>
  )
}
