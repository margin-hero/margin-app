// £1,234.56 / −£12.00 from integer (or fractional) pence
export function pounds(pence: number): string {
  const value = Math.abs(pence) / 100
  return `${pence < 0 ? '−' : ''}£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// 12.3% (or — when there's no revenue to divide by)
export function percent(value: number | null): string {
  return value === null ? '—' : `${value}%`
}
