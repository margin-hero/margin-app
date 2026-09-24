'use client'

import { useState } from 'react'

const CHANNELS = ['Amazon', 'eBay', 'B&Q', 'The Range', 'Debenhams', 'Tesco', 'OnBuy', 'Temu', 'TikTok Shop']

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

  const yellow = '#DCFF00'
  const green = '#39FF6A'
  const red = '#FF4C4C'
  const bg = '#1A1A1A'
  const card = '#232323'
  const border = '#333'

  function SignupForm({ compact = false }: { compact?: boolean }) {
    return status === 'success' ? (
      <p style={{ color: green, fontSize: '15px', fontWeight: 500 }}>You're on the list — we'll be in touch soon.</p>
    ) : (
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: compact ? 'flex-start' : 'center' }}>
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            padding: '12px 16px',
            borderRadius: '6px',
            border: `0.5px solid #444`,
            background: card,
            color: '#fff',
            fontSize: '15px',
            width: '260px',
          }}
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          style={{
            background: yellow,
            color: bg,
            border: 'none',
            borderRadius: '6px',
            padding: '12px 22px',
            fontSize: '15px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {status === 'loading' ? 'Joining...' : 'Notify me'}
        </button>
      </form>
    )
  }

  return (
    <div style={{ background: bg, color: '#fff', fontFamily: 'sans-serif' }}>
      {/* Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 32px', borderBottom: `0.5px solid ${border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '22px', color: yellow }}>↗</span>
          <span style={{ fontSize: '18px', fontWeight: 500 }}>Margin Hero</span>
        </div>
        <a href="#waitlist" style={{ background: yellow, color: bg, borderRadius: '6px', padding: '8px 16px', fontSize: '14px', fontWeight: 500, textDecoration: 'none' }}>
          Join the waitlist
        </a>
      </div>

      {/* Hero */}
      <div style={{ padding: '80px 24px 48px', textAlign: 'center' }}>
        <p style={{ fontSize: '13px', color: green, letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 16px' }}>
          Built for UK e-commerce sellers
        </p>
        <h1 style={{ fontSize: 'clamp(32px, 5vw, 52px)', fontWeight: 500, margin: '0 0 20px', maxWidth: '760px', marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.2 }}>
          Know your margin.<br />On every SKU, every channel.
        </h1>
        <p style={{ fontSize: '17px', color: '#bbb', maxWidth: '540px', margin: '0 auto 36px', lineHeight: 1.6 }}>
          The only margin calculator built around how UK sellers actually sell — Amazon, eBay, B&Q, The Range, Debenhams, Tesco, OnBuy, Temu, and TikTok Shop, in one place, with UK VAT done properly.
        </p>
        <div id="waitlist">
          <SignupForm />
        </div>
      </div>

      {/* Channel strip */}
      <div style={{ padding: '0 24px 64px', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' }}>
        {CHANNELS.map((c) => (
          <span key={c} style={{ fontSize: '13px', color: '#aaa', background: card, border: `0.5px solid ${border}`, borderRadius: '20px', padding: '6px 14px' }}>
            {c}
          </span>
        ))}
      </div>

      {/* Preview grid */}
      <div style={{ padding: '0 24px 64px' }}>
        <div style={{ background: card, borderRadius: '12px', padding: '20px', maxWidth: '680px', margin: '0 auto', border: `0.5px solid ${border}` }}>
          <p style={{ fontSize: '12px', color: '#888', margin: '0 0 14px' }}>Gross vs Net margin, by SKU and channel</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr repeat(3, 0.9fr)', gap: '6px', fontSize: '12px', alignItems: 'center' }}>
            <span style={{ color: '#888' }}>SKU / Product</span>
            <span style={{ color: '#888', textAlign: 'center' }}>Amazon</span>
            <span style={{ color: '#888', textAlign: 'center' }}>B&Q</span>
            <span style={{ color: '#888', textAlign: 'center' }}>TikTok</span>

            <div style={{ lineHeight: 1.4 }}>
              <div style={{ color: yellow, fontWeight: 500 }}>LL-1</div>
              <div style={{ color: '#999', fontSize: '11px' }}>Lazy-Leaf Blower</div>
            </div>
            <span style={{ background: 'rgba(57,255,106,0.15)', color: green, borderRadius: '4px', padding: '5px 2px', textAlign: 'center', fontWeight: 500 }}>34%</span>
            <span style={{ background: 'rgba(220,255,0,0.12)', color: yellow, borderRadius: '4px', padding: '5px 2px', textAlign: 'center', fontWeight: 500 }}>18%</span>
            <span style={{ background: 'rgba(255,76,76,0.15)', color: red, borderRadius: '4px', padding: '5px 2px', textAlign: 'center', fontWeight: 500 }}>-6%</span>

            <div style={{ lineHeight: 1.4 }}>
              <div style={{ color: yellow, fontWeight: 500 }}>PB-3</div>
              <div style={{ color: '#999', fontSize: '11px' }}>Garden Rake</div>
            </div>
            <span style={{ background: 'rgba(57,255,106,0.15)', color: green, borderRadius: '4px', padding: '5px 2px', textAlign: 'center', fontWeight: 500 }}>29%</span>
            <span style={{ background: 'rgba(57,255,106,0.15)', color: green, borderRadius: '4px', padding: '5px 2px', textAlign: 'center', fontWeight: 500 }}>25%</span>
            <span style={{ color: '#555', textAlign: 'center' }}>—</span>
          </div>
        </div>
      </div>

      {/* Positioning section */}
      <div style={{ padding: '0 24px 80px', maxWidth: '900px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '26px', fontWeight: 500, textAlign: 'center', margin: '0 0 12px' }}>
          Every other margin tool is built for someone else's business
        </h2>
        <p style={{ color: '#999', textAlign: 'center', maxWidth: '600px', margin: '0 auto 48px', lineHeight: 1.6 }}>
          Amazon-only tools miss the rest of your channels. Shopify-first tools have never heard of B&Q or The Range.
          Margin Hero is built around the actual mix of marketplaces UK sellers use.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
          <div style={{ background: card, borderRadius: '12px', border: `0.5px solid ${border}`, padding: '22px' }}>
            <p style={{ fontSize: '14px', fontWeight: 500, color: yellow, margin: '0 0 8px' }}>Every UK marketplace, natively</p>
            <p style={{ fontSize: '13px', color: '#999', lineHeight: 1.6, margin: 0 }}>
              Amazon, eBay, and the Mirakl retailers (B&Q, The Range, Debenhams, Tesco) alongside OnBuy, Temu and TikTok Shop — not an afterthought bolted onto a Shopify-first tool.
            </p>
          </div>
          <div style={{ background: card, borderRadius: '12px', border: `0.5px solid ${border}`, padding: '22px' }}>
            <p style={{ fontSize: '14px', fontWeight: 500, color: yellow, margin: '0 0 8px' }}>Gross and Net, properly separated</p>
            <p style={{ fontSize: '13px', color: '#999', lineHeight: 1.6, margin: 0 }}>
              See what's left after landed cost alone, and what's left after everything — fees, shipping, VAT, the lot. Two honest numbers, not one blended guess.
            </p>
          </div>
          <div style={{ background: card, borderRadius: '12px', border: `0.5px solid ${border}`, padding: '22px' }}>
            <p style={{ fontSize: '14px', fontWeight: 500, color: yellow, margin: '0 0 8px' }}>UK VAT, done right</p>
            <p style={{ fontSize: '13px', color: '#999', lineHeight: 1.6, margin: 0 }}>
              VAT-registered or not, zero-rated products, marketplace-collected VAT — handled correctly per product, not assumed away.
            </p>
          </div>
          <div style={{ background: card, borderRadius: '12px', border: `0.5px solid ${border}`, padding: '22px' }}>
            <p style={{ fontSize: '14px', fontWeight: 500, color: yellow, margin: '0 0 8px' }}>Margin. Just margin.</p>
            <p style={{ fontSize: '13px', color: '#999', lineHeight: 1.6, margin: 0 }}>
              No PPC bidding tools, no review-request automation, no CRM creep. One thing, done properly, so you can actually trust the number.
            </p>
          </div>
          <div style={{ background: card, borderRadius: '12px', border: `0.5px solid ${border}`, padding: '22px' }}>
            <p style={{ fontSize: '14px', fontWeight: 500, color: yellow, margin: '0 0 8px' }}>Alerts before it hurts</p>
            <p style={{ fontSize: '13px', color: '#999', lineHeight: 1.6, margin: 0 }}>
              Get told the moment a SKU dips into the red — not weeks later when you're checking last quarter's numbers.
            </p>
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div style={{ padding: '64px 24px', textAlign: 'center', borderTop: `0.5px solid ${border}` }}>
        <h2 style={{ fontSize: '24px', fontWeight: 500, margin: '0 0 8px' }}>Get early access</h2>
        <p style={{ color: '#999', margin: '0 0 28px' }}>We're building it now. Leave your email and we'll let you know the moment it's ready.</p>
        <SignupForm />
        {status === 'error' && <p style={{ color: red, fontSize: '13px', marginTop: '12px' }}>{errorMessage}</p>}
      </div>

      <div style={{ padding: '24px', textAlign: 'center', color: '#555', fontSize: '12px', borderTop: `0.5px solid ${border}` }}>
        © {new Date().getFullYear()} Margin Hero
      </div>
    </div>
  )
}
