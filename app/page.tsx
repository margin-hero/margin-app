'use client'

import { useState } from 'react'
import PublicHeader from '@/components/PublicHeader'
import PricingPlans from '@/components/PricingPlans'
import PublicFooter from '@/components/PublicFooter'
import { lime, green, amber, red, bg, panel, panelRaised, border, text, muted, dim, font, display, marginTier, radius } from '@/lib/theme'

// "live" = import already works in the app. Update as new importers ship.
const CHANNELS: { name: string; live: boolean }[] = [
  { name: 'Amazon', live: true },
  { name: 'Amazon FBA', live: true },
  { name: 'eBay', live: true },
  { name: 'B&Q', live: true },
  { name: 'The Range', live: true },
  { name: 'Debenhams', live: true },
  { name: 'Tesco', live: true },
  { name: 'Argos', live: true },
  { name: 'OnBuy', live: true },
  { name: 'Shopify', live: true },
  { name: 'Temu', live: true },
  { name: 'TikTok Shop', live: true },
  { name: 'More channels', live: false },
]

// What goes into the margin figure (hero chips). soon = on the roadmap, not live yet.
const COUNTED: { label: string; soon?: boolean }[] = [
  { label: 'Sales' },
  { label: 'Channel fees' },
  { label: 'Refunds' },
  { label: 'Couriers' },
  { label: 'Landed cost' },
  { label: 'Packaging' },
  { label: 'Overheads' },
  { label: 'VAT' },
  { label: 'Ad spend', soon: true },
]

// ---- Sample data for the dashboard mockup (illustrative only) ----
const KPIS = [
  { label: 'Net revenue', value: '£48,210', delta: '+12.4%', good: true },
  { label: 'Net profit', value: '£9,874', delta: '+8.1%', good: true },
  { label: 'Net margin', value: '20.5%', delta: '−0.9 pts', good: false },
  { label: 'SKUs losing money', value: '3', delta: '+1 this month', good: false },
]

const STORES = [
  { name: 'B&Q', margin: 31.2 },
  { name: 'Amazon', margin: 24.1 },
  { name: 'Debenhams', margin: 22.4 },
  { name: 'The Range', margin: 17.8 },
  { name: 'Tesco', margin: 11.3 },
  { name: 'TikTok Shop', margin: -4.6 },
]

const GRID_STORES = ['Amazon', 'B&Q', 'The Range', 'Debenhams', 'Tesco', 'Argos', 'TikTok Shop']
const GRID_SKUS: { sku: string; name: string; margins: (number | null)[] }[] = [
  { sku: 'LL-1', name: 'Lazy-Leaf Blower', margins: [34, 18, 21, 26, 15, 23, -6] },
  { sku: 'PB-3', name: 'Garden Rake', margins: [29, 25, null, 19, 11, 27, 12] },
  { sku: 'HS-12', name: 'Hose Reel 30m', margins: [8, 31, 19, null, 6, 17, null] },
  { sku: 'PL-7', name: 'Planter Set (3)', margins: [22, 14, -2, 16, 9, null, 9] },
]

const MOVERS = [
  { sku: 'PB-3', store: 'B&Q', profit: 2140 },
  { sku: 'LL-1', store: 'Amazon', profit: 1865 },
  { sku: 'HS-12', store: 'B&Q', profit: 1210 },
  { sku: 'PL-7', store: 'The Range', profit: -138 },
  { sku: 'LL-1', store: 'TikTok Shop', profit: -412 },
]

function formatPounds(n: number) {
  return `${n < 0 ? '−' : '+'}£${Math.abs(n).toLocaleString('en-GB')}`
}

const eyebrow: React.CSSProperties = { fontSize: '12px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: lime, margin: '0 0 16px' }
const cardStyle: React.CSSProperties = { background: panel, border: `1px solid ${border}`, borderRadius: '16px', padding: '22px' }
const cardTitle: React.CSSProperties = { fontSize: '13px', fontWeight: 600, color: muted, margin: '0 0 18px', textTransform: 'uppercase', letterSpacing: '0.06em' }

export default function HoldingPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage('')

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()

      if (!res.ok) {
        setStatus('error')
        setErrorMessage(data.error || 'Something went wrong.')
        return
      }

      setStatus('success')
      setEmail('')
    } catch {
      setStatus('error')
      setErrorMessage('Something went wrong. Please try again.')
    }
  }

  // Called as a function (not rendered as <SignupForm />) so the input isn't
  // re-created on every keystroke, which would make it lose focus.
  function signupForm() {
    if (status === 'success') {
      return <p style={{ color: green, fontSize: '17px', fontWeight: 600 }}>You&apos;re on the list — we&apos;ll be in touch soon.</p>
    }
    return (
      <>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <input
            type="email"
            required
            placeholder="you@yourstore.co.uk"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              padding: '15px 20px',
              borderRadius: radius,
              border: `1px solid ${border}`,
              background: panel,
              color: text,
              fontSize: '16px',
              fontFamily: font,
              width: '300px',
              maxWidth: '100%',
            }}
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            style={{
              background: lime,
              color: bg,
              border: 'none',
              borderRadius: radius,
              padding: '15px 28px',
              fontSize: '15px',
              fontWeight: 800,
              fontFamily: font,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              cursor: 'pointer',
            }}
          >
            {status === 'loading' ? 'Joining...' : 'Get early access'}
          </button>
        </form>
        {status === 'error' && <p style={{ color: red, fontSize: '14px', marginTop: '12px' }}>{errorMessage}</p>}
        <p style={{ color: dim, fontSize: '12px', margin: '12px 0 0' }}>
          We&apos;ll only email you about Margin Hero. Unsubscribe any time. <a href="/privacy" style={{ color: muted }}>Privacy notice</a>
        </p>
      </>
    )
  }

  const maxStoreMargin = Math.max(...STORES.map((s) => Math.abs(s.margin)))

  return (
    <div style={{ background: bg, color: text, fontFamily: font, overflowX: 'hidden' }}>
      <PublicHeader />

      {/* Hero */}
      <div style={{ padding: 'clamp(48px, 9vw, 110px) 16px 56px', textAlign: 'center' }}>
        <p style={eyebrow}>For UK marketplace &amp; ecommerce sellers</p>
        <h1 style={{ ...display, fontSize: 'clamp(40px, 9vw, 116px)', lineHeight: 0.92, margin: '0 auto 28px', maxWidth: '1150px' }}>
          Know your margin.<br /><span style={{ color: lime }}>SKU by SKU.</span>
        </h1>
        <p style={{ fontSize: 'clamp(17px, 2vw, 21px)', color: muted, maxWidth: '640px', margin: '0 auto 24px', lineHeight: 1.5 }}>
          The real profit on every product, in every store, side by side. Find out which SKUs and stores make you money and which quietly lose it.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px', maxWidth: '680px', margin: '0 auto 36px' }}>
          {COUNTED.map((c) => (
            <span key={c.label} style={{ fontSize: '13px', fontWeight: 700, padding: '6px 12px', borderRadius: radius, border: `1px solid ${border}`, background: panel, color: c.soon ? dim : text }}>
              {c.label}{c.soon && <span style={{ fontWeight: 600 }}> · soon</span>}
            </span>
          ))}
        </div>
        <div id="waitlist">{signupForm()}</div>
      </div>

      {/* Dashboard mockup */}
      <div style={{ padding: '0 16px 96px' }}>
        <div style={{ maxWidth: '1180px', margin: '0 auto', background: panelRaised, border: `1px solid ${border}`, borderRadius: '24px', padding: 'clamp(14px, 2.5vw, 28px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
            <div>
              <p style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>Margin overview</p>
              <p style={{ fontSize: '13px', color: muted, margin: '4px 0 0' }}>Last 30 days · all stores · sample data</p>
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {['7D', '30D', '90D'].map((p) => (
                <span key={p} style={{ fontSize: '12px', fontWeight: 700, padding: '6px 12px', borderRadius: radius, background: p === '30D' ? lime : panel, color: p === '30D' ? bg : muted, border: `1px solid ${p === '30D' ? lime : border}` }}>
                  {p}
                </span>
              ))}
            </div>
          </div>

          {/* KPI tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '14px' }}>
            {KPIS.map((k, i) => (
              <div key={k.label} style={{ ...cardStyle, background: i === 1 ? lime : panel, color: i === 1 ? bg : text, border: i === 1 ? 'none' : cardStyle.border }}>
                <p style={{ fontSize: '13px', fontWeight: 600, margin: '0 0 14px', color: i === 1 ? bg : muted }}>{k.label}</p>
                <p style={{ ...display, fontSize: 'clamp(34px, 4vw, 46px)', margin: '0 0 10px', lineHeight: 1 }}>{k.value}</p>
                <span style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: radius,
                  background: i === 1 ? bg : k.good ? 'rgba(57,255,106,0.14)' : 'rgba(255,76,76,0.14)',
                  color: i === 1 ? lime : k.good ? green : red,
                }}>
                  {k.delta}
                </span>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
            {/* Net margin by store */}
            <div style={cardStyle}>
              <p style={cardTitle}>Net margin by store</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {STORES.map((s) => {
                  const c = marginTier(s.margin)
                  return (
                    <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 56px', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '14px', color: text }}>{s.name}</span>
                      <div style={{ background: bg, borderRadius: '999px', height: '12px', overflow: 'hidden' }}>
                        <div style={{ width: `${(Math.abs(s.margin) / maxStoreMargin) * 100}%`, height: '100%', background: c.fg, borderRadius: '999px' }} />
                      </div>
                      <span style={{ fontSize: '15px', fontWeight: 800, color: c.fg, textAlign: 'right' }}>{s.margin.toFixed(1)}%</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Winners and leaks */}
            <div style={cardStyle}>
              <p style={cardTitle}>Biggest winners &amp; leaks</p>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {MOVERS.map((m, i) => (
                  <div key={`${m.sku}-${m.store}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderTop: i === 0 ? 'none' : `1px solid ${border}` }}>
                    <div>
                      <span style={{ fontSize: '15px', fontWeight: 800, color: lime }}>{m.sku}</span>
                      <span style={{ fontSize: '13px', color: muted, marginLeft: '10px' }}>{m.store}</span>
                    </div>
                    <span style={{ fontSize: '17px', fontWeight: 800, color: m.profit < 0 ? red : green }}>{formatPounds(m.profit)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* SKU x store comparison */}
          <div style={{ ...cardStyle, marginTop: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }}>
              <p style={{ ...cardTitle, margin: 0 }}>Net margin · SKU × store</p>
              <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: muted }}>
                <span><span style={{ color: red }}>●</span> under 10%</span>
                <span><span style={{ color: amber }}>●</span> 10–20%</span>
                <span><span style={{ color: green }}>●</span> 20%+</span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'separate', borderSpacing: '6px', width: '100%', minWidth: '820px', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', fontSize: '12px', color: muted, fontWeight: 600, padding: '4px', width: '150px' }}>SKU</th>
                    {GRID_STORES.map((s) => (
                      <th key={s} style={{ fontSize: '12px', color: muted, fontWeight: 600, padding: '4px' }}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {GRID_SKUS.map((row) => {
                    const best = Math.max(...row.margins.filter((m): m is number => m !== null))
                    return (
                      <tr key={row.sku}>
                        <td style={{ padding: '4px' }}>
                          <div style={{ fontSize: '15px', fontWeight: 800, color: text }}>{row.sku}</div>
                          <div style={{ fontSize: '12px', color: muted }}>{row.name}</div>
                        </td>
                        {row.margins.map((m, j) => {
                          const c = marginTier(m)
                          return (
                            <td key={j} style={{
                              background: c.bg,
                              color: c.fg,
                              textAlign: 'center',
                              fontSize: '17px',
                              fontWeight: 800,
                              padding: '12px 6px',
                              borderRadius: '10px',
                              outline: m === best ? `2px solid ${c.fg}` : 'none',
                              outlineOffset: '-2px',
                            }}>
                              {m === null ? '—' : `${m}%`}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: '12px', color: dim, margin: '12px 0 0' }}>Outlined cell = the most profitable store for that SKU.</p>
          </div>
        </div>
      </div>

      {/* Channels */}
      <div style={{ padding: '0 16px 110px', textAlign: 'center' }}>
        <p style={eyebrow}>Where you sell</p>
        <h2 style={{ ...display, fontSize: 'clamp(30px, 5vw, 60px)', lineHeight: 0.95, margin: '0 auto 16px', maxWidth: '900px' }}>
          All your stores. One margin view.
        </h2>
        <p style={{ fontSize: '17px', color: muted, maxWidth: '560px', margin: '0 auto 40px', lineHeight: 1.5 }}>
          Built around the marketplaces UK sellers actually use, not just Amazon and Shopify.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', maxWidth: '1000px', margin: '0 auto' }}>
          {CHANNELS.map((c) => (
            <div key={c.name} style={{ background: panel, border: `1px solid ${border}`, borderRadius: '14px', padding: '22px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px', fontWeight: 800, color: c.live ? text : muted }}>{c.name}</span>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                padding: '3px 10px',
                borderRadius: radius,
                background: c.live ? 'rgba(57,255,106,0.14)' : 'transparent',
                color: c.live ? green : dim,
                border: c.live ? 'none' : `1px solid ${border}`,
              }}>
                {c.live ? 'Live' : 'Coming soon'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <div style={{ padding: '0 16px 110px', maxWidth: '1180px', margin: '0 auto' }}>
        <p style={{ ...eyebrow, textAlign: 'center' }}>Why Margin Hero</p>
        <h2 style={{ ...display, fontSize: 'clamp(30px, 5vw, 60px)', lineHeight: 0.95, textAlign: 'center', margin: '0 auto 48px', maxWidth: '950px' }}>
          Margin. <span style={{ color: lime }}>Just margin.</span>
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
          {[
            { title: 'SKU by SKU, store by store', body: 'Compare the same product across every marketplace at a glance. Spot where it earns and where it bleeds.' },
            { title: 'Every cost counted', body: 'Channel fees, refunds and return postage, couriers, landed cost, packaging and overheads. Gross and Net kept apart, so you see both. Ad spend coming soon.' },
            { title: 'Multi-store, multi-platform', body: 'Two eBay stores? Three TikTok shops for different brands? No problem. Every store is tracked on its own, with its own VAT setting.' },
            { title: 'Flexible where it matters', body: 'Costs that change over time, bundles and multipacks, courier price lists, overheads shared your way, and your own margin colour bands.' },
            { title: 'UK VAT, done right', body: 'VAT-registered or not, zero-rated products, per-product rates. Handled properly, not assumed away.' },
            { title: 'Just margin', body: 'No PPC bidding, no review requests, no CRM creep. One job, done properly, so you can trust the number.' },
          ].map((f, i) => (
            <div key={f.title} style={{ ...cardStyle, padding: '28px' }}>
              <p style={{ ...display, fontSize: '40px', color: lime, margin: '0 0 18px', lineHeight: 1 }}>{String(i + 1).padStart(2, '0')}</p>
              <p style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 10px' }}>{f.title}</p>
              <p style={{ fontSize: '15px', color: muted, lineHeight: 1.55, margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div style={{ padding: '0 16px 110px', textAlign: 'center' }}>
        <p style={eyebrow}>Pricing</p>
        <h2 style={{ ...display, fontSize: 'clamp(30px, 5vw, 60px)', lineHeight: 0.95, margin: '0 auto 16px', maxWidth: '900px' }}>
          Every feature. <span style={{ color: lime }}>Every plan.</span>
        </h2>
        <p style={{ fontSize: '17px', color: muted, maxWidth: '600px', margin: '0 auto 36px', lineHeight: 1.5 }}>
          Every feature is on every plan. You only pay based on your monthly orders: every channel, unlimited stores and SKUs, no per-channel or per-SKU fees.
        </p>
        <PricingPlans />
        <p style={{ marginTop: '24px' }}>
          <a href="/pricing" style={{ color: lime, fontWeight: 700, fontSize: '15px' }}>See everything that&apos;s included →</a>
        </p>
      </div>

      {/* Bottom CTA */}
      <div style={{ padding: '96px 16px', textAlign: 'center', background: lime, color: bg }}>
        <h2 style={{ ...display, fontSize: 'clamp(34px, 6.5vw, 84px)', lineHeight: 0.92, margin: '0 auto 20px', maxWidth: '1000px' }}>
          Margin is what pays the bills.
        </h2>
        <p style={{ fontSize: '18px', margin: '0 auto 32px', maxWidth: '520px', lineHeight: 1.5 }}>
          Stop guessing yours. We&apos;re building Margin Hero now: leave your email and we&apos;ll tell you the moment it&apos;s ready.
        </p>
        <a href="#waitlist" style={{ display: 'inline-block', background: bg, color: lime, borderRadius: radius, padding: '16px 30px', fontSize: '15px', fontWeight: 800, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Join the waitlist ↑
        </a>
      </div>

      <PublicFooter />
    </div>
  )
}
