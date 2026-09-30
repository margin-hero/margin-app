import type { CSSProperties } from 'react'

// Brand palette, shared by the homepage and the app.
// Lime + near-black/olive greys, with bright red / green for losing / winning margin.
export const lime = '#D2FF00'
export const green = '#39FF6A'
export const red = '#FF4C4C'
export const bg = '#111112'
export const panel = '#1B1C19'
export const panelRaised = '#23251F'
export const border = '#2E3029'
export const text = '#EBEEE0'
export const muted = '#9A9D8F'
export const dim = '#5E6158'

export const font = 'var(--font-mona), Arial, sans-serif'
// Extra-wide, extra-heavy cut of Mona Sans for headlines
export const display: CSSProperties = { fontFamily: font, fontStretch: '125%', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '-0.01em' }
