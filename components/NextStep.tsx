import Link from 'next/link'
import { lime, muted, border, cardStyle } from '@/lib/theme'

// "What to do next" box at the bottom of a set-up page, so setting up the app runs in
// order (see /getting-started for the whole list).
export default function NextStep({ href, label, text }: { href: string; label: string; text?: string }) {
  return (
    <div style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', borderStyle: 'dashed', borderColor: border }}>
      <div>
        <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, margin: '0 0 4px' }}>Next step</p>
        {text && <p style={{ fontSize: '14px', color: muted, margin: 0, lineHeight: 1.5 }}>{text}</p>}
      </div>
      <Link href={href} style={{ color: lime, fontWeight: 800, fontSize: '15px', textDecoration: 'none', whiteSpace: 'nowrap' }}>{label} →</Link>
    </div>
  )
}
