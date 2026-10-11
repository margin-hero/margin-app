'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ALERT_RULES, type RuleSetting } from '@/lib/alertRules'
import { lime, muted, red, text, inputStyle, cardStyle, cardTitle } from '@/lib/theme'

// Switch each alert rule on / off and change its threshold. Saved per business (alert_rules);
// the page then works the alerts out again.
export default function AlertRules({ rules, canSave }: { rules: RuleSetting[]; canSave: boolean }) {
  const router = useRouter()
  const [settings, setSettings] = useState(rules)
  const [error, setError] = useState('')

  async function save(code: string, changes: Partial<RuleSetting>) {
    const next = settings.map((r) => (r.code === code ? { ...r, ...changes } : r))
    setSettings(next)
    const r = next.find((s) => s.code === code)!
    setError('')
    const { error } = await supabase.from('alert_rules').upsert(
      { rule_code: code, enabled: r.enabled, threshold: r.threshold, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id,rule_code' } // tenant_id is filled in from the login
    )
    if (error) setError(`Couldn't save: ${error.message}`)
    else router.refresh()
  }

  return (
    <section aria-label="Alert rules" style={{ ...cardStyle, flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h2 style={{ ...cardTitle, margin: 0 }}>Alert rules</h2>
      {ALERT_RULES.map((def) => {
        const r = settings.find((s) => s.code === def.code)!
        return (
          <div key={def.code} style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between', minHeight: '44px' }}>
            <label htmlFor={`rule-${def.code}`} style={{ fontSize: '14px', color: r.enabled ? text : muted, cursor: canSave ? 'pointer' : 'default' }}>
              {def.label}
              <br />
              <span style={{ fontSize: '12px', color: muted }}>{def.explain(r.threshold)}</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              {def.threshold && (
                <input
                  type="number"
                  min={0}
                  step={def.threshold.unit === 'days' ? 1 : 0.5}
                  defaultValue={r.threshold}
                  disabled={!canSave || !r.enabled}
                  aria-label={`${def.label} threshold (${def.threshold.unit})`}
                  title={def.threshold.unit}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v) && v >= 0 && v !== r.threshold) save(def.code, { threshold: v })
                  }}
                  style={{ ...inputStyle, width: '64px', padding: '6px 8px' }}
                />
              )}
              <input
                id={`rule-${def.code}`}
                type="checkbox"
                checked={r.enabled}
                disabled={!canSave}
                onChange={(e) => save(def.code, { enabled: e.target.checked })}
                style={{ width: '22px', height: '22px', accentColor: lime }}
              />
            </div>
          </div>
        )
      })}
      {!canSave && <p style={{ fontSize: '12px', color: muted, margin: 0 }}>Run the database update 20261011140000_alert_rules.sql to change these.</p>}
      {error && <p style={{ fontSize: '12px', color: red, margin: 0 }}>{error}</p>}
      <p style={{ fontSize: '12px', color: muted, margin: 0 }}>Email and push alerts are on the roadmap.</p>
    </section>
  )
}
