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
