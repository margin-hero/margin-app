'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_GROUPS = [
  {
    label: 'Dashboards',
    links: [
      { href: '/channel-overview', label: 'Channel Overview' },
      { href: '/grid', label: 'Grid' },
      { href: '/sku-detail', label: 'SKU Detail' },
      { href: '/margins', label: 'Margins' },
      { href: '/trends', label: 'Trends' },
    ],
  },
  {
    label: 'Import',
    links: [
      { href: '/upload', label: 'CSV Upload' },
      { href: '/amazon-import', label: 'Amazon' },
      { href: '/tiktok-catalog', label: 'TikTok Catalog' },
      { href: '/tiktok-import', label: 'TikTok' },
      { href: '/mirakl-import', label: 'Mirakl' },
    ],
  },
  {
    label: 'Manage',
    links: [
      { href: '/products', label: 'Products' },
      { href: '/mappings', label: 'Mappings' },
    ],
  },
]

export default function Nav() {
  const pathname = usePathname()

  return (
    <div style={{ background: '#1A1A1A', borderBottom: '0.5px solid #333', padding: '12px 24px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '18px', color: '#DCFF00' }}>↗</span>
        <Link href="/grid" style={{ fontSize: '16px', fontWeight: 500, color: '#fff', textDecoration: 'none' }}>
          Margin Hero
        </Link>
      </div>
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {group.label}
            </span>
            {group.links.map((link) => {
              const active = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  style={{
                    fontSize: '13px',
                    color: active ? '#DCFF00' : '#bbb',
                    textDecoration: 'none',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
