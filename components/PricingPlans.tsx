'use client'

import { useState } from 'react'
import { PLANS, annualPounds, ordersLabel } from '@/lib/pricing'
import { lime, green, bg, panel, border, text, muted, dim, font, display } from '@/lib/theme'

// Plan cards with a Monthly / Annual switch. Used on /pricing and the homepage.
export default function PricingPlans({ ctaHref = '/#waitlist' }: { ctaHref?: string }) {
  const [annual, setAnnual] = useState(false)

  return (
    <div style={{ fontFamily: font }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '28px' }}>
        {[
          { label: 'Monthly', on: !annual, onClick: () => setAnnual(false) },
          { label: 'Annual · 2 months free', on: annual, onClick: () => setAnnual(true) },
        ].map((t) => (
          <button
            key={t.label}
            onClick={t.onClick}
            style={{ fontFamily: font, fontSize: '13px', fontWeight: 700, padding: '8px 16px', borderRadius: '999px', cursor: 'pointer', background: t.on ? lime : panel, color: t.on ? bg : muted, border: `1px solid ${t.on ? lime : border}` }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '14px', maxWidth: '1180px', margin: '0 auto' }}>
        {PLANS.map((plan) => {
          const custom = plan.monthlyPounds === null
          const yearly = annualPounds(plan)
          return (
            <div key={plan.name} style={{ background: panel, border: `1px solid ${border}`, borderRadius: '18px', padding: '26px', display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
              <p style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: lime, margin: '0 0 14px' }}>{plan.name}</p>
              {custom ? (
                <p style={{ ...display, fontSize: '40px', margin: '0 0 6px', lineHeight: 1 }}>Let&apos;s talk</p>
              ) : (
                <p style={{ margin: '0 0 6px', lineHeight: 1 }}>
                  <span style={{ ...display, fontSize: '46px' }}>£{annual ? (yearly! / 12).toFixed(2).replace(/\.00$/, '') : plan.monthlyPounds}</span>
                  <span style={{ color: muted, fontSize: '14px', marginLeft: '6px' }}>/ month</span>
                </p>
              )}
              <p style={{ color: dim, fontSize: '13px', margin: '0 0 18px', minHeight: '18px' }}>
                {custom ? 'Custom pricing' : annual ? `£${yearly!.toLocaleString('en-GB')} billed yearly · ex. VAT` : 'Billed monthly · ex. VAT'}
              </p>
              <p style={{ color: text, fontSize: '16px', fontWeight: 800, margin: '0 0 6px' }}>{ordersLabel(plan)}</p>
              <p style={{ color: muted, fontSize: '14px', margin: '0 0 18px', lineHeight: 1.5, flex: 1 }}>{plan.blurb}</p>
              <p style={{ color: green, fontSize: '13px', fontWeight: 700, margin: '0 0 18px' }}>✓ Every feature included</p>
              <a
                href={ctaHref}
                style={{ display: 'block', textAlign: 'center', background: custom ? 'transparent' : lime, color: custom ? lime : bg, border: `1px solid ${lime}`, borderRadius: '999px', padding: '12px 18px', fontSize: '13px', fontWeight: 800, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.04em' }}
              >
                {custom ? 'Get in touch' : 'Join the waitlist'}
              </a>
            </div>
          )
        })}
      </div>
    </div>
  )
}
