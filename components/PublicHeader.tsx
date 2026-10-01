import Link from 'next/link'
import { lime, bg, muted, display } from '@/lib/theme'

// Top bar for the public pages (homepage, pricing)
export default function PublicHeader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px clamp(16px, 4vw, 40px)', gap: '12px' }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'inherit' }}>
        <span style={{ fontSize: '24px', color: lime, fontWeight: 900 }}>↗</span>
        <span style={{ ...display, fontSize: '18px' }}>Margin Hero</span>
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
        <Link href="/pricing" style={{ color: muted, fontSize: '14px', fontWeight: 700, textDecoration: 'none' }}>Pricing</Link>
        <a href="/#waitlist" style={{ background: lime, color: bg, borderRadius: '999px', padding: '10px 18px', fontSize: '13px', fontWeight: 800, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
          Join the waitlist
        </a>
      </div>
    </div>
  )
}
