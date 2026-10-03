// £1,234.56 / −£12.00 from integer (or fractional) pence
export function pounds(pence: number): string {
  const value = Math.abs(pence) / 100
  return `${pence < 0 ? '−' : ''}£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// 12.3% (or — when there's no revenue to divide by)
export function percent(value: number | null): string {
  return value === null ? '—' : `${value}%`
}

// Costs are entered inc. VAT. Explains what gets counted, e.g. for a product cost
// that applies to several stores with different VAT registration. null until both are filled in.
export function vatSplitNote(amountText: string, vatRateText: string): string | null {
  const amount = Number(amountText)
  if (amountText.trim() === '' || !Number.isFinite(amount) || amount < 0 || vatRateText === '') return null
  const gross = Math.round(amount * 100)
  const vat = Math.round((gross * Number(vatRateText)) / (1 + Number(vatRateText)))
  if (vat === 0) return `${pounds(gross)} counted everywhere (no VAT on this).`
  return `${pounds(gross)} inc. VAT = ${pounds(gross - vat)} + ${pounds(vat)} VAT. VAT-registered stores count ${pounds(gross - vat)}; other stores count the full ${pounds(gross)}.`
}

// UK-friendly date for display: "2026-09-01" -> "01-09-2026". Dates are still stored
// and compared as YYYY-MM-DD; only use this when showing a date.
export function ukDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso
}

// "2026-09" -> "Sep 2026" (chart labels)
export function ukMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
