import Link from 'next/link'
import Logo from '@/components/Logo'
import { COMPANY } from '@/lib/company'
import { muted, dim, text, border } from '@/lib/theme'

const heading: React.CSSProperties = { fontSize: '12px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: dim, margin: '0 0 12px' }
const link: React.CSSProperties = { display: 'block', color: muted, fontSize: '14px', textDecoration: 'none', margin: '0 0 8px' }

// Footer for the public pages (homepage, pricing, privacy)
export default function PublicFooter() {
  return (
    <footer style={{ borderTop: `1px solid ${border}`, padding: '48px clamp(16px, 4vw, 40px) 28px' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '32px' }}>
        <div>
          <Logo size={24} />
          <p style={{ color: muted, fontSize: '14px', lineHeight: 1.5, margin: '14px 0 0', maxWidth: '260px' }}>
            SKU-level margin for UK marketplace and ecommerce sellers.
          </p>
        </div>
        <div>
          <p style={heading}>Product</p>
          <Link href="/pricing" style={link}>Pricing</Link>
          <a href="/#waitlist" style={link}>Join the waitlist</a>
          <Link href="/login" style={link}>Log in</Link>
        </div>
        <div>
          <p style={heading}>Legal</p>
          <Link href="/privacy" style={link}>Privacy notice</Link>
          <Link href="/privacy#cookies" style={link}>Cookies</Link>
        </div>
        <div>
          <p style={heading}>Contact</p>
          <a href={`mailto:${COMPANY.contactEmail}`} style={{ ...link, color: text }}>{COMPANY.contactEmail}</a>
        </div>
      </div>
      <p style={{ maxWidth: '1180px', margin: '36px auto 0', color: dim, fontSize: '12px', lineHeight: 1.6 }}>
        © {new Date().getFullYear()} {COMPANY.tradingName} is a trading name of {COMPANY.legalName}, registered in {COMPANY.registeredIn}
        (company no. {COMPANY.companyNumber}). Registered office: {COMPANY.registeredAddress}. ICO registration: {COMPANY.icoNumber}.
        Marketplace names are trademarks of their respective owners.
      </p>
    </footer>
  )
}
