import type { Metadata } from 'next'
import PublicHeader from '@/components/PublicHeader'
import PricingPlans from '@/components/PricingPlans'
import { INCLUDED, FAIR_TERMS, PLANS, ANNUAL_MONTHS_CHARGED } from '@/lib/pricing'
import { lime, green, bg, panel, border, text, muted, dim, font, display } from '@/lib/theme'

export const metadata: Metadata = {
  title: 'Pricing · Margin Hero',
  description: 'Simple pricing based on order volume. Every UK channel and every feature on every plan. No per-channel or per-SKU fees.',
}

const eyebrow: React.CSSProperties = { fontSize: '12px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: lime, margin: '0 0 16px' }
const h2: React.CSSProperties = { ...display, fontSize: 'clamp(28px, 4.5vw, 52px)', lineHeight: 0.95, margin: '0 auto 16px', maxWidth: '900px' }

const FAQ: { q: string; a: string }[] = [
  { q: 'What counts as an order?', a: 'One customer order, however many products are in it. We count orders across all your stores over a rolling 30 days.' },
  { q: 'Are some features only on bigger plans?', a: 'No. Every plan includes every channel, every feature, unlimited stores and unlimited SKUs. The only difference is how many orders a month you process.' },
  { q: 'Is VAT included?', a: "Prices are shown excluding VAT. Where VAT applies, it's added on top at the standard UK rate." },
  { q: 'How does annual billing work?', a: `Pay for ${ANNUAL_MONTHS_CHARGED} months and get 12. That's roughly two months free compared with paying monthly.` },
  { q: 'Can I change plan?', a: 'Yes. Move up or down as your volume changes.' },
]

export default function PricingPage() {
  const top = PLANS[PLANS.length - 2]
  return (
    <div style={{ background: bg, color: text, fontFamily: font, overflowX: 'hidden', minHeight: '100vh' }}>
      <PublicHeader />

      {/* Hero + plans */}
      <div style={{ padding: 'clamp(40px, 7vw, 90px) 16px 80px', textAlign: 'center' }}>
        <p style={eyebrow}>Pricing</p>
        <h1 style={{ ...display, fontSize: 'clamp(38px, 7.5vw, 96px)', lineHeight: 0.92, margin: '0 auto 24px', maxWidth: '1100px' }}>
          Pay for orders.<br /><span style={{ color: lime }}>Not features.</span>
        </h1>
        <p style={{ fontSize: 'clamp(16px, 2vw, 20px)', color: muted, maxWidth: '640px', margin: '0 auto 44px', lineHeight: 1.5 }}>
          Every plan includes every UK channel and every feature. The only thing that changes is how many orders you process a month.
        </p>
        <PricingPlans />
        <p style={{ color: dim, fontSize: '13px', marginTop: '20px' }}>
          Prices in GBP, excluding VAT. Over {top.ordersUpTo!.toLocaleString('en-GB')} orders a month? We&apos;ll put together a custom plan.
        </p>
      </div>

      {/* Fair terms */}
      <div style={{ padding: '0 16px 100px', maxWidth: '1180px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={eyebrow}>Fair by design</p>
          <h2 style={h2}>Simple. <span style={{ color: lime }}>Fair.</span></h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginTop: '40px' }}>
          {FAIR_TERMS.map((t, i) => (
            <div key={t.title} style={{ background: panel, border: `1px solid ${border}`, borderRadius: '16px', padding: '26px' }}>
              <p style={{ ...display, fontSize: '34px', color: lime, margin: '0 0 14px', lineHeight: 1 }}>{String(i + 1).padStart(2, '0')}</p>
              <p style={{ fontSize: '19px', fontWeight: 800, margin: '0 0 10px' }}>{t.title}</p>
              <p style={{ fontSize: '15px', color: muted, lineHeight: 1.55, margin: 0 }}>{t.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Everything included */}
      <div style={{ padding: '0 16px 100px', maxWidth: '1180px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={eyebrow}>Included on every plan</p>
          <h2 style={h2}>Everything. <span style={{ color: lime }}>From day one.</span></h2>
          <p style={{ fontSize: '17px', color: muted, maxWidth: '600px', margin: '0 auto', lineHeight: 1.5 }}>
            No gatekeeping. A seller on Starter gets exactly the same Margin Hero as a seller on Scale.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px', marginTop: '40px' }}>
          {INCLUDED.map((group) => (
            <div key={group.title} style={{ background: panel, border: `1px solid ${border}`, borderRadius: '16px', padding: '26px' }}>
              <p style={{ fontSize: '19px', fontWeight: 800, margin: '0 0 16px' }}>{group.title}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {group.items.map((item) => (
                  <li key={item} style={{ display: 'flex', gap: '10px', fontSize: '15px', color: muted, lineHeight: 1.45 }}>
                    <span style={{ color: green, fontWeight: 900 }}>✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div style={{ padding: '0 16px 100px', maxWidth: '820px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <p style={eyebrow}>Questions</p>
          <h2 style={h2}>Pricing FAQ</h2>
        </div>
        {FAQ.map((f) => (
          <details key={f.q} style={{ borderTop: `1px solid ${border}`, padding: '18px 4px' }}>
            <summary style={{ fontSize: '17px', fontWeight: 800, cursor: 'pointer' }}>{f.q}</summary>
            <p style={{ fontSize: '15px', color: muted, lineHeight: 1.6, margin: '12px 0 0' }}>{f.a}</p>
          </details>
        ))}
      </div>

      {/* Bottom CTA */}
      <div style={{ padding: '90px 16px', textAlign: 'center', background: lime, color: bg }}>
        <h2 style={{ ...display, fontSize: 'clamp(32px, 6vw, 76px)', lineHeight: 0.92, margin: '0 auto 20px', maxWidth: '1000px' }}>
          Know your real margin.
        </h2>
        <p style={{ fontSize: '18px', margin: '0 auto 30px', maxWidth: '520px', lineHeight: 1.5 }}>
          We&apos;re building it now. Join the waitlist and we&apos;ll tell you the moment it&apos;s ready.
        </p>
        <a href="/#waitlist" style={{ display: 'inline-block', background: bg, color: lime, borderRadius: '999px', padding: '16px 30px', fontSize: '15px', fontWeight: 800, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Join the waitlist
        </a>
      </div>

      <div style={{ padding: '28px 16px', textAlign: 'center', color: dim, fontSize: '13px' }}>
        © {new Date().getFullYear()} Margin Hero · Marketplace names are trademarks of their respective owners.
      </div>
    </div>
  )
}
