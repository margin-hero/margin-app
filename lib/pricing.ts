// Pricing plans, shared by /pricing and the homepage pricing section so they never disagree.
// GBP, ex. VAT. Plans differ ONLY by order volume: every feature is on every plan.
// Annual = roughly 10 months' price (two months free), rounded down to whole pounds per month.

export type Plan = {
  name: string
  monthlyPounds: number | null // null = custom pricing
  ordersUpTo: number | null // orders per rolling 30 days; null = no upper limit
  blurb: string
}

export const PLANS: Plan[] = [
  { name: 'Solo', monthlyPounds: 9, ordersUpTo: 250, blurb: 'For smaller and newer shops, e.g. a TikTok or Etsy side business.' },
  { name: 'Starter', monthlyPounds: 24, ordersUpTo: 2000, blurb: 'For sellers getting serious about margin.' },
  { name: 'Growth', monthlyPounds: 44, ordersUpTo: 6000, blurb: 'For growing multichannel shops.' },
  { name: 'Scale', monthlyPounds: 79, ordersUpTo: 20000, blurb: 'For established, high-volume sellers.' },
  { name: 'Enterprise', monthlyPounds: null, ordersUpTo: null, blurb: 'Over 20,000 orders a month? Let\'s talk.' },
]

export const ANNUAL_MONTHS_CHARGED = 10

// Annual plans shown as a whole-pound monthly figure: 10 months' price spread over 12, rounded DOWN
export function annualMonthlyPounds(plan: Plan): number | null {
  return plan.monthlyPounds === null ? null : Math.floor((plan.monthlyPounds * ANNUAL_MONTHS_CHARGED) / 12)
}

// Billed yearly = that rounded monthly figure x 12, so the two always agree
export function annualPounds(plan: Plan): number | null {
  const monthly = annualMonthlyPounds(plan)
  return monthly === null ? null : monthly * 12
}

export function ordersLabel(plan: Plan): string {
  return plan.ordersUpTo === null ? '20,000+ orders / month' : `Up to ${plan.ordersUpTo.toLocaleString('en-GB')} orders / month`
}

// Selling points: all included on every plan
export const INCLUDED: { title: string; items: string[] }[] = [
  {
    title: 'Every UK channel',
    items: [
      'Amazon (FBA and your own shipping, compared side by side), TikTok Shop, eBay, Shopify, Temu, OnBuy, B&Q, The Range, Debenhams, Tesco and Argos imports',
      'Plus any other channel via CSV or Excel upload',
      'Unlimited stores, including several shops on the same marketplace',
      'Unlimited SKUs and products',
    ],
  },
  {
    title: 'True margin, SKU by SKU',
    items: [
      'SKU × store margin grid: see where every product earns and where it bleeds',
      'Gross profit and net profit, kept apart',
      'Net profit after overheads, shared fairly across your sales',
      'Your own red / amber / green margin thresholds',
      'Alerts the moment a SKU’s margin drops below your threshold (coming soon)',
    ],
  },
  {
    title: 'Costs done properly',
    items: [
      'Dated costs: price changes never rewrite your history',
      'All-in landed cost, or product cost + freight + duty',
      'Per-unit and per-order costs (pick & pack, boxes), bundles handled',
      'Courier price list + shipping profiles: one price change updates every product',
      'Overheads: wages, rent, subscriptions, equipment spread over its life',
    ],
  },
  {
    title: 'UK VAT and clean data',
    items: [
      'VAT registered or not, set per store, with per-product VAT rates',
      'Bulk product, mapping and cost imports from CSV or Excel',
      'Unmapped SKUs held back, not dumped in as junk products',
      'Warnings when costs are missing, so margins are never quietly overstated',
    ],
  },
]

export const FAIR_TERMS: { title: string; body: string }[] = [
  {
    title: 'Orders, not line items',
    body: 'A customer buying three different products is one order. We count orders over a rolling 30 days.',
  },
  {
    title: 'No per-channel or per-SKU fees',
    body: 'Selling in more places is the point. Adding a store or a thousand SKUs never changes your price.',
  },
]
