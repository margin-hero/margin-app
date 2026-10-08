import { ImportSummaryData } from '@/lib/importEngine'
import { lime, amber, red, text, muted } from '@/lib/theme'

// A headline plus short grouped bullet lists, for what's in a file before import and the
// result afterwards. Headline colour: lime = all good, amber = needs attention, red = failed.
export default function ImportSummary({ summary }: { summary: ImportSummaryData }) {
  const headlineColor = summary.tone === 'error' ? red : summary.tone === 'warn' ? amber : lime
  return (
    <div style={{ marginTop: '16px' }}>
      <p style={{ color: headlineColor, fontSize: '15px', fontWeight: 700, margin: 0 }}>{summary.headline}</p>
      {summary.sections.map((sec) => (
        <div key={sec.title} style={{ marginTop: '12px' }}>
          <p style={{ color: sec.tone === 'warn' ? amber : text, fontSize: '13px', fontWeight: 700, margin: 0 }}>{sec.title}</p>
          <ul style={{ color: muted, fontSize: '13px', lineHeight: 1.6, margin: '4px 0 0', paddingLeft: '18px' }}>
            {sec.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}
