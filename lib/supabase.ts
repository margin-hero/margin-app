import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Browser client: keeps the logged-in session in a cookie, so the server (proxy and
// server pages, via lib/supabaseServer.ts) can see who is logged in too.
// Server pages must use createServerSupabase() instead: this one doesn't know the user there.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
