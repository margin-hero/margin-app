// The business behind Margin Hero, shown in the public footer and the privacy notice.
// Anything in [square brackets] still needs filling in before these pages go live.
export const COMPANY = {
  tradingName: 'Margin Hero',
  legalName: '[Company legal name]', // e.g. "Example Ltd"
  companyNumber: '[Company number]', // Companies House number
  registeredIn: '[England and Wales]', // where the company is registered (confirm)
  registeredAddress: '[Registered office address]',
  contactEmail: '[Contact email]', // e.g. hello@marginhero.co.uk
  icoNumber: '[ICO registration number]', // after paying the ICO data protection fee
  databaseRegion: '[Supabase project region]', // Supabase dashboard → Project Settings, e.g. "London (UK)"
  accountRetention: '[90 days]', // how soon a closed account's data is deleted
  privacyLastUpdated: '6 October 2026',
}

// True while any detail above is still a placeholder
export const companyDetailsMissing = Object.values(COMPANY).some((v) => v.startsWith('['))
