import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Pages anyone can see without logging in (keep in step with PUBLIC_PAGES in AppShell)
const OPEN_PATHS = ['/', '/pricing', '/login', '/privacy']

// Runs before every page: refreshes the Supabase login session and sends anyone
// who isn't logged in to /login. The real protection is RLS in the database; this
// just stops logged-out visitors seeing empty app pages.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // getUser() checks the session with Supabase (and refreshes it if needed)
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  if (!user && !OPEN_PATHS.includes(path) && !path.startsWith('/api/')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', path + request.nextUrl.search)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  // Skip Next.js internals and static files (images, icons)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
