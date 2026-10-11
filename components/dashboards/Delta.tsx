import { green, red, muted } from '@/lib/theme'
import { pounds } from '@/lib/format'

// Change vs the comparison period: ▲ / ▼ in green (better) or red (worse).
//   change: % change of a figure (e.g. net profit ▲ 8.2%); falls back to the £ difference
//           when the earlier figure was zero or a loss, where a % would mislead
//   money:  £ difference (e.g. profit per unit ▼ £0.21)
//   points: difference between two percentages (e.g. net margin ▼ 1.1 pts)
// goodWhen="down" for costs (e.g. TACOS): going up is shown as worse.
export default function Delta({ current, previous, kind, goodWhen = 'up', money = true, compact = false }: {
  current: number | null
  previous: number | null
  kind: 'change' | 'money' | 'points'
  goodWhen?: 'up' | 'down'
  money?: boolean // for kind="change": the figure is pence (fallback shows £); false = a count
  compact?: boolean // just "▲ 1.2 pts" (e.g. inside a grid cell), no "vs prior"
}) {
  if (current === null || previous === null) return <span style={{ color: muted }}>{compact ? 'new' : 'No figure to compare'}</span>
  const diff = current - previous
  if (Math.abs(diff) < (kind === 'points' ? 0.05 : 0.5)) return <span style={{ color: muted }}>{compact ? 'no change' : 'No change vs prior'}</span>

  let amount: string
  if (kind === 'points') amount = `${Math.abs(Math.round(diff * 10) / 10)} pts`
  else if (kind === 'change' && previous > 0) amount = `${Math.abs(Math.round((diff / previous) * 1000) / 10)}%`
  else if (money) amount = pounds(Math.abs(diff))
  else amount = Math.abs(diff).toLocaleString('en-GB')

  const up = diff > 0
  const good = up === (goodWhen === 'up')
  return (
    <span style={{ color: good ? green : red }}>
      <span aria-hidden="true">{up ? '▲' : '▼'} </span>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{up ? 'up' : 'down'} </span>
      {amount}{compact ? '' : ' vs prior'}
    </span>
  )
}
