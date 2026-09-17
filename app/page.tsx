'use client'

import { useState } from 'react'

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

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#1A1A1A',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'sans-serif',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '32px' }}>
        <span style={{ fontSize: '28px', color: '#DCFF00' }}>↗</span>
        <span style={{ fontSize: '20px', fontWeight: 500, color: '#fff' }}>Margin Hero</span>
      </div>

      <p style={{ fontSize: '13px', color: '#39FF6A', letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 16px' }}>
        Coming soon
      </p>

      <h1 style={{ fontSize: '36px', fontWeight: 500, color: '#fff', margin: '0 0 16px', maxWidth: '600px', lineHeight: 1.3 }}>
        Know your margin. On every SKU, every channel.
      </h1>

      <p style={{ fontSize: '16px', color: '#bbb', maxWidth: '460px', margin: '0 0 32px', lineHeight: 1.6 }}>
        A margin calculator built for UK e-commerce sellers — Amazon, eBay, and every marketplace in one place.
        We're building it now. Leave your email and we'll let you know the moment it's ready.
      </p>

      {status === 'success' ? (
        <p style={{ color: '#39FF6A', fontSize: '15px', fontWeight: 500 }}>
          You're on the list — we'll be in touch soon.
        </p>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              padding: '12px 16px',
              borderRadius: '6px',
              border: '0.5px solid #444',
              background: '#232323',
              color: '#fff',
              fontSize: '15px',
              width: '260px',
            }}
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            style={{
              background: '#DCFF00',
              color: '#1a1a1a',
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
      )}

      {status === 'error' && (
        <p style={{ color: '#FF4C4C', fontSize: '13px', marginTop: '12px' }}>{errorMessage}</p>
      )}
    </div>
  )
}
