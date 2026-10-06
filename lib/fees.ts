// Fees broken down by type. The codes match the fee_types table (a fixed list,
// changed by migration only), so keep the two in step.
export const FEE_TYPES = {
  commission: 'Commission / referral fee',
  fulfilment: 'Fulfilment',
  payment: 'Payment processing',
  shipping: 'Shipping fees',
  advertising: 'Advertising & promotions',
  affiliate: 'Affiliate / creator commission',
  other_fee: 'Other channel fees',
  unspecified: 'Not broken down',
} as const

export type FeeType = keyof typeof FEE_TYPES

// One fee on one order line. label = the fee's name in the channel's file.
// grossPence includes VAT; a credit (e.g. a fee refund) is negative.
export type FeeLine = { type: FeeType; label: string; grossPence: number; vatPence: number }

// Adds a fee to the list, combining it with an existing one of the same type and label.
export function addFee(lines: FeeLine[], type: FeeType, label: string, grossPence: number, vatPence = 0) {
  if (!grossPence && !vatPence) return
  const existing = lines.find((l) => l.type === type && l.label === label)
  if (existing) {
    existing.grossPence += grossPence
    existing.vatPence += vatPence
  } else {
    lines.push({ type, label, grossPence, vatPence })
  }
}

export function feeTotals(lines: FeeLine[]) {
  return {
    grossPence: lines.reduce((sum, l) => sum + l.grossPence, 0),
    vatPence: lines.reduce((sum, l) => sum + l.vatPence, 0),
  }
}

// For channels that only give the VAT as one figure for all fees: shares it across the
// fees by size. The last fee takes any leftover penny, so the VAT adds up exactly.
export function shareVat(lines: FeeLine[], vatPence: number) {
  const totalGross = lines.reduce((sum, l) => sum + l.grossPence, 0)
  let left = vatPence
  lines.forEach((l, i) => {
    const last = i === lines.length - 1
    l.vatPence = last ? left : totalGross ? Math.round((vatPence * l.grossPence) / totalGross) : 0
    left -= l.vatPence
  })
}
