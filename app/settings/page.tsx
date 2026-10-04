'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { loadMarginRanges } from '@/lib/marginRanges'
import { lime, red, muted, dim, pageStyle, eyebrow, pageTitle, pageIntro, cardStyle, cardTitle, inputStyle, primaryButton, marginTier } from '@/lib/theme'

const EXAMPLES = [-5, 5, 8, 12, 15, 18, 22, 30]

export default function SettingsPage() {
  const [redBelow, setRedBelow] = useState('')
  const [greenFrom, setGreenFrom] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    loadMarginRanges().then((r) => {
      setRedBelow(String(r.redBelow))
      setGreenFrom(String(r.greenFrom))
    })
  }, [])

  const red_ = Number(redBelow)
  const green_ = Number(greenFrom)
  const valid = redBelow.trim() !== '' && greenFrom.trim() !== '' && Number.isFinite(red_) && Number.isFinite(green_) && green_ >= red_

  async function save() {
    if (!valid) {
      setStatus('Enter two numbers, with green starting at or above where red ends.')
      return
    }
    // An update needs a filter, so target the logged-in user's tenant
    const { data: tenantId } = await supabase.rpc('current_tenant_id')
    const { error } = await supabase
      .from('tenants')
      .update({ margin_red_below: red_, margin_green_from: green_ })
      .eq('id', tenantId)
    setStatus(error ? `Error saving: ${error.message}` : 'Saved. Every dashboard now uses these ranges.')
  }

  return (
    <div style={pageStyle}>
      <p style={eyebrow}>Manage</p>
      <h1 style={pageTitle}>Settings</h1>
      <p style={pageIntro}>Business-wide settings. How overheads are shared is set on the <Link href="/overheads" style={{ color: lime, fontWeight: 700 }}>Overheads</Link> page.</p>
      {status && <p style={{ color: status.startsWith('Error') || status.startsWith('Enter') ? red : lime, fontSize: '14px', fontWeight: 600, marginTop: '16px' }}>{status}</p>}

      <div style={cardStyle}>
        <p style={cardTitle}>Margin colours</p>
        <p style={{ fontSize: '14px', color: muted, margin: '0 0 16px', lineHeight: 1.5 }}>
          What counts as a good margin depends on what you sell. Set where red ends and green begins; anything in between is amber.
          Used on the Grid, Channel Overview and SKU Detail.
        </p>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '14px', color: muted }}>
            Red below <input value={redBelow} onChange={(e) => setRedBelow(e.target.value)} style={{ ...inputStyle, width: '70px', margin: '0 4px' }} />%
          </label>
          <label style={{ fontSize: '14px', color: muted }}>
            Green from <input value={greenFrom} onChange={(e) => setGreenFrom(e.target.value)} style={{ ...inputStyle, width: '70px', margin: '0 4px' }} />%
          </label>
          <button onClick={save} style={primaryButton}>Save</button>
        </div>

        {valid && (
          <div style={{ marginTop: '20px' }}>
            <p style={{ fontSize: '12px', color: dim, margin: '0 0 8px' }}>Preview</p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {EXAMPLES.map((m) => {
                const tier = marginTier(m, { redBelow: red_, greenFrom: green_ })
                return (
                  <span key={m} style={{ background: tier.bg, color: tier.fg, fontWeight: 800, fontSize: '15px', padding: '10px 14px', borderRadius: '10px', minWidth: '56px', textAlign: 'center' }}>
                    {m}%
                  </span>
                )
              })}
            </div>
          </div>
        )}
        <p style={{ fontSize: '12px', color: dim, margin: '16px 0 0' }}>Different ranges per store or per product are planned for later.</p>
      </div>
    </div>
  )
}
