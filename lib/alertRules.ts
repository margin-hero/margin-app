// The alert rules and their defaults (lib/alerts.ts works them out; components/dashboards/
// AlertRules.tsx switches them on / off). Saved settings live in alert_rules.

export type RuleCode = 'loss' | 'margin_drop' | 'acos' | 'fee_change' | 'missing_costs' | 'stale_import'

export const ALERT_RULES: { code: RuleCode; label: string; explain: (n: number) => string; threshold?: { default: number; unit: string } }[] = [
  { code: 'loss', label: 'Selling at a loss', explain: () => 'A product loses money in a store (net margin below 0%)' },
  { code: 'margin_drop', label: 'Margin dropping', explain: (n) => `Net margin down ${n} pts or more vs the period before`, threshold: { default: 3, unit: 'pts' } },
  { code: 'acos', label: 'Ads above break-even', explain: () => 'ACOS higher than the break-even ACOS: the ads cost more than the product makes' },
  { code: 'fee_change', label: 'Fees per unit up', explain: (n) => `Channel fees per unit up ${n}% or more vs the period before`, threshold: { default: 10, unit: '%' } },
  { code: 'missing_costs', label: 'Missing costs', explain: () => 'Orders with no product cost or no shipping cost (margins overstated)' },
  { code: 'stale_import', label: 'Import overdue', explain: (n) => `A store's newest order is more than ${n} days old`, threshold: { default: 7, unit: 'days' } },
]

export type RuleSetting = { code: RuleCode; enabled: boolean; threshold: number }
