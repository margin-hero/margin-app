import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

// Supabase client for server pages (e.g. /margins), acting as the logged-in user from
// the session cookie, so database security (RLS) applies to them. Create one per request.
export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        // Server pages can't set cookies; proxy.ts refreshes the session instead
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {}
      },
    },
  })
}
