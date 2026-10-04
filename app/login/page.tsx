'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { red, muted, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, inputStyle, primaryButton } from '@/lib/theme'

// Login page. There's no sign-up yet: users are created in Supabase (Authentication → Users)
// and linked to their tenant in tenant_members.
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function logIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }
    // Back to the page they asked for (only within this site), else the main dashboard
    const next = new URLSearchParams(window.location.search).get('next')
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/channel-overview'
    // Full page load so server pages pick up the new login cookie
    window.location.assign(safeNext)
  }

  return (
    <div style={{ ...pageStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <p style={eyebrow}>Margin Hero</p>
        <h1 style={pageTitle}>Log in</h1>
        <p style={pageIntro}>Use the email and password you were given.</p>
        <form onSubmit={logIn} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: muted }}>
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: muted }}>
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
          </label>
          {error && <p style={{ color: red, fontSize: '13px', margin: 0 }}>{error}</p>}
          <button type="submit" disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  )
}
