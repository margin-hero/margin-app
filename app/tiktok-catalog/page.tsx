import { redirect } from 'next/navigation'

// The TikTok catalog upload now lives on the Mappings page (TikTok SKU IDs are part of
// each TikTok listing). Kept as a redirect so old links and bookmarks still work.
export default function TikTokCatalogPage() {
  redirect('/mappings')
}
