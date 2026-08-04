import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes reachable without a session. Everything else is treated as an
// authenticated route group. This is an optimistic, cookie-only check per
// Next.js's Proxy auth guidance -- it exists to redirect unauthenticated
// visitors before a protected page renders (avoiding a flash of a page
// that client-side useRequireRole would immediately bounce from). It is
// not a substitute for RLS or the per-role client-side checks, which stay
// exactly as they are.
const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/privacy",
  "/auth",
  "/api",
  "/manifest.webmanifest",
];

function isProtectedPath(pathname: string): boolean {
  if (pathname === "/") return false;
  return !PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Carries over any Set-Cookie from a session refresh onto a redirect
// response -- redirecting is a separate NextResponse from the one
// createServerClient's setAll wrote the refreshed cookies onto, so without
// this a token refresh that happens to land on the same request as a
// redirect would be silently dropped.
function withRefreshedCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase config there is no session to refresh — let the
  // request through rather than crashing every route in the app.
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refreshes the auth token if needed. Do not add logic between
  // createServerClient and this call, or the session may randomly expire.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && isProtectedPath(pathname)) {
    return withRefreshedCookies(
      response,
      NextResponse.redirect(new URL("/login", request.url))
    );
  }

  if (user && (pathname === "/login" || pathname === "/register")) {
    // "/" already does the real role-based redirect server-side (see
    // src/app/page.tsx) -- avoid duplicating that logic here.
    return withRefreshedCookies(response, NextResponse.redirect(new URL("/", request.url)));
  }

  return response;
}
