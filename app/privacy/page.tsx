import type { Metadata } from 'next'
import PublicHeader from '@/components/PublicHeader'
import PublicFooter from '@/components/PublicFooter'
import { COMPANY, companyDetailsMissing } from '@/lib/company'
import { lime, amber, bg, text, muted, font, display, radius } from '@/lib/theme'

export const metadata: Metadata = {
  title: 'Privacy notice · Margin Hero',
  description: 'How Margin Hero collects, uses and protects personal data.',
}

const h2: React.CSSProperties = { fontSize: '20px', fontWeight: 800, color: text, margin: '40px 0 12px' }
const p: React.CSSProperties = { fontSize: '15px', color: muted, lineHeight: 1.65, margin: '0 0 12px' }
const li: React.CSSProperties = { fontSize: '15px', color: muted, lineHeight: 1.65, margin: '0 0 8px' }
const strong: React.CSSProperties = { color: text }

// Keep this page true to what the app actually does: if a new feature collects or shares
// personal data (analytics, a new sub-processor, storing buyer details...), update it.
export default function PrivacyPage() {
  return (
    <div style={{ background: bg, color: text, fontFamily: font, minHeight: '100vh' }}>
      <PublicHeader />
      <main style={{ maxWidth: '760px', margin: '0 auto', padding: 'clamp(32px, 6vw, 72px) 16px 72px' }}>
        <p style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: lime, margin: '0 0 14px' }}>Legal</p>
        <h1 style={{ ...display, fontSize: 'clamp(34px, 6vw, 60px)', lineHeight: 0.95, margin: '0 0 16px' }}>Privacy notice</h1>
        <p style={{ ...p, color: muted }}>Last updated: {COMPANY.privacyLastUpdated}</p>

        {companyDetailsMissing && (
          <p style={{ ...p, color: amber, border: `1px solid ${amber}`, borderRadius: radius, padding: '12px 16px' }}>
            Draft: some business details below still need filling in.
          </p>
        )}

        <p style={p}>
          This notice explains what personal data {COMPANY.tradingName} collects, why, who helps us process it, how long we keep it and
          your rights. We keep it short because we collect very little.
        </p>

        <h2 style={h2}>Who we are</h2>
        <p style={p}>
          {COMPANY.tradingName} is a trading name of {COMPANY.legalName} (company no. {COMPANY.companyNumber}), registered office{' '}
          {COMPANY.registeredAddress}. We are registered with the UK Information Commissioner&apos;s Office (ICO), registration{' '}
          {COMPANY.icoNumber}. For anything about your data, email <a href={`mailto:${COMPANY.contactEmail}`} style={{ color: lime }}>{COMPANY.contactEmail}</a>.
        </p>

        <h2 style={h2}>What we collect and why</h2>
        <p style={p}><strong style={strong}>Waitlist.</strong> If you join the waitlist we keep your email address, so we can tell you when Margin Hero is
          ready and send occasional updates about it. Our lawful basis is your consent, which you can withdraw at any time using the
          unsubscribe link in any email, or by emailing us.</p>
        <p style={p}><strong style={strong}>Your account.</strong> If you use Margin Hero we keep your login email and password (stored securely by our
          login provider; we never see your password) and your account settings. Our lawful basis is providing the service you&apos;ve asked for.</p>
        <p style={p}><strong style={strong}>Your business data.</strong> The sales reports, products, costs and other figures you add are your business&apos;s
          data. We process them on your behalf only to provide the service, and you stay in control of them.</p>
        <p style={p}><strong style={strong}>Your customers.</strong> Sales reports from marketplaces often include your buyers&apos; names and addresses.
          Margin Hero reads each report in your browser and keeps only what&apos;s needed for margins: order and product references, dates,
          quantities and amounts. Buyer names, addresses and contact details are not uploaded or stored, and the report file itself isn&apos;t kept.</p>

        <h2 style={h2}>Who helps us</h2>
        <p style={p}>We use a small number of trusted providers (&ldquo;sub-processors&rdquo;), each bound by a data processing agreement:</p>
        <ul style={{ paddingLeft: '20px', margin: '0 0 12px' }}>
          <li style={li}><strong style={strong}>Supabase</strong>: database and logins. Data is stored in {COMPANY.databaseRegion}.</li>
          <li style={li}><strong style={strong}>Vercel</strong>: hosts the website and app.</li>
          <li style={li}><strong style={strong}>Resend</strong>: stores the waitlist and sends our emails.</li>
        </ul>
        <p style={p}>
          Where a provider handles data outside the UK, the transfer is protected by the safeguards UK law requires, such as the UK
          International Data Transfer Addendum or the UK–US data bridge. We never sell your data or use it for advertising.
        </p>

        <h2 id="cookies" style={h2}>Cookies and browser storage</h2>
        <p style={p}>
          We don&apos;t use advertising or analytics cookies. When you log in, a strictly necessary cookie keeps you logged in. The app also
          remembers a few display choices in your browser (such as whether the menu is collapsed, or how a page is sorted). Neither is used
          to track you, so no cookie banner is needed. If that ever changes, we&apos;ll ask first.
        </p>

        <h2 style={h2}>How long we keep it</h2>
        <ul style={{ paddingLeft: '20px', margin: '0 0 12px' }}>
          <li style={li}>Waitlist emails: until you unsubscribe or ask us to delete them.</li>
          <li style={li}>Accounts and business data: while your account is open. When you close it, we delete it within {COMPANY.accountRetention}, unless the law requires us to keep something longer.</li>
        </ul>

        <h2 style={h2}>Your rights</h2>
        <p style={p}>
          You can ask for a copy of your data, ask us to correct or delete it, object to or restrict how we use it, ask for it in a portable
          format, and withdraw consent at any time. Email us and we&apos;ll respond within one month. If you&apos;re unhappy with how we&apos;ve
          handled your data, you can complain to the ICO at <a href="https://ico.org.uk" style={{ color: lime }}>ico.org.uk</a> or on 0303 123 1113,
          though we&apos;d appreciate the chance to put it right first.
        </p>

        <h2 style={h2}>Changes</h2>
        <p style={p}>If we change how we use personal data, we&apos;ll update this notice and the date at the top, and tell account holders about anything significant.</p>
      </main>
      <PublicFooter />
    </div>
  )
}
