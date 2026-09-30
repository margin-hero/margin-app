'use client'

import { usePathname } from 'next/navigation'
import Nav from '@/components/Nav'
import { bg } from '@/lib/theme'

// Wraps every app page with the sidebar. The public homepage ("/") is left as-is.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/') return <>{children}</>

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: bg }}>
      <Nav />
      <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
    </div>
  )
}
