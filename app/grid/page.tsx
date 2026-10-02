import { redirect } from 'next/navigation'

// The SKU × store grid is now the Margins page. Kept as a redirect so old links and
// bookmarks still work.
export default function GridPage() {
  redirect('/margins')
}
