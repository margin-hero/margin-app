'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Grid3x3, ScanSearch, Percent, TrendingUp,
  FileUp, ShoppingCart, BookOpen, Music2, Building2,
  Store, Package, Link2, ListPlus, PoundSterling, FileSpreadsheet, Truck, Boxes, Building, PanelLeftClose, PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react'
import { lime, bg, border, text, muted, dim, font, display } from '@/lib/theme'

const NAV_GROUPS: { label: string; links: { href: string; label: string; icon: LucideIcon }[] }[] = [
  {
    label: 'Dashboards',
    links: [
      { href: '/channel-overview', label: 'Channel Overview', icon: LayoutDashboard },
      { href: '/grid', label: 'Grid', icon: Grid3x3 },
      { href: '/sku-detail', label: 'SKU Detail', icon: ScanSearch },
      { href: '/margins', label: 'Margins', icon: Percent },
      { href: '/trends', label: 'Trends', icon: TrendingUp },
    ],
  },
  {
    label: 'Import',
    links: [
      { href: '/upload', label: 'CSV / Excel', icon: FileUp },
      { href: '/amazon-import', label: 'Amazon', icon: ShoppingCart },
      { href: '/tiktok-catalog', label: 'TikTok Catalog', icon: BookOpen },
      { href: '/tiktok-import', label: 'TikTok', icon: Music2 },
      { href: '/mirakl-import', label: 'Mirakl', icon: Building2 },
    ],
  },
  {
    label: 'Manage',
    links: [
      { href: '/stores', label: 'Stores', icon: Store },
      { href: '/products', label: 'Products', icon: Package },
      { href: '/mappings', label: 'Mappings', icon: Link2 },
      { href: '/catalog-import', label: 'Catalog Import', icon: ListPlus },
      { href: '/costs', label: 'Costs', icon: PoundSterling },
      { href: '/cost-import', label: 'Cost Import', icon: FileSpreadsheet },
      { href: '/couriers', label: 'Couriers', icon: Truck },
      { href: '/shipping-profiles', label: 'Shipping Profiles', icon: Boxes },
      { href: '/overheads', label: 'Overheads', icon: Building },
    ],
  },
]

const STORAGE_KEY = 'mh-sidebar-collapsed'

// Collapsible left-hand sidebar. Collapsed = icons only (hover for the name).
// The choice is remembered in this browser.
export default function Nav() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved !== null) setCollapsed(saved === '1')
      else if (window.innerWidth < 768) setCollapsed(true)
    } catch {
      // Storage unavailable (e.g. private browsing) — just use the default
    }
  }, [])

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    } catch {}
  }

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <aside
      style={{
        width: collapsed ? '68px' : '232px',
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: bg,
        borderRight: `1px solid ${border}`,
        fontFamily: font,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 12px',
        transition: 'width 0.2s ease',
      }}
    >
      <Link href="/grid" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', marginBottom: '28px', textDecoration: 'none', color: text, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: '22px', color: lime, fontWeight: 900 }}>↗</span>
        {!collapsed && <span style={{ ...display, fontSize: '15px' }}>Margin Hero</span>}
      </Link>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: '22px', flex: 1 }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {collapsed ? (
              <div style={{ borderTop: `1px solid ${border}`, margin: '0 10px 10px' }} />
            ) : (
              <p style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: dim, margin: '0 0 8px', padding: '0 12px' }}>
                {group.label}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {group.links.map((link) => {
                const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
                const Icon = link.icon
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    title={collapsed ? link.label : undefined}
                    className={active ? undefined : 'hover:bg-[#1B1C19] hover:!text-[#EBEEE0]'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      gap: '12px',
                      padding: '9px 12px',
                      borderRadius: '999px',
                      fontSize: '14px',
                      fontWeight: active ? 800 : 600,
                      textDecoration: 'none',
                      whiteSpace: 'nowrap',
                      background: active ? lime : 'transparent',
                      color: active ? bg : muted,
                    }}
                  >
                    <Icon size={18} strokeWidth={2.2} style={{ flexShrink: 0 }} />
                    {!collapsed && link.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={toggle}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}
        className="hover:bg-[#1B1C19] hover:!text-[#EBEEE0]"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: '12px',
          marginTop: '20px',
          padding: '9px 12px',
          borderRadius: '999px',
          border: 'none',
          background: 'transparent',
          color: muted,
          fontFamily: font,
          fontSize: '14px',
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <ToggleIcon size={18} strokeWidth={2.2} style={{ flexShrink: 0 }} />
        {!collapsed && 'Collapse'}
      </button>
    </aside>
  )
}
