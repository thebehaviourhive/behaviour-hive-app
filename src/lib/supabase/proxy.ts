import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasConsented } from "@/lib/hasConsented";
import { getPostAuthRedirect } from "@/lib/roleRedirect";

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

  // PWA cold-start fix: this used to just bounce to "/" and let
  // src/app/page.tsx (an async Server Component) do the real
  // consent-check + role-based redirect there. Measured on the
  // deployed app: because that page does `await
  // supabase.auth.getUser()` BEFORE calling redirect(), Next.js has
  // already started streaming the response by the time the redirect
  // fires, so it can't send a real HTTP 30x any more -- it falls back
  // to embedding `<meta http-equiv="refresh" content="1;url=...">` in
  // the (nearly blank) HTML, which is a mandatory ~1s dead pause
  // before the browser even STARTS loading the real destination. That
  // was the single biggest piece of the reported black-screen/white-
  // flash cold start.
  //
  // The proxy runs before any page rendering begins at all, so a
  // redirect issued here is a real, instant HTTP 307 -- no meta-
  // refresh tax. This computes the exact same destination
  // (consent -> role dashboard) src/app/page.tsx already computes, for
  // both "/" itself and the case of an already-authenticated user
  // landing on /login or /register, sending them straight to their
  // real destination in one hop instead of bouncing through "/" and
  // paying the tax there too. src/app/page.tsx's own logic is left in
  // place, untouched, as a fallback for any request this proxy
  // doesn't intercept (e.g. Supabase unreachable) -- not deleted, just
  // no longer the only path.
  if (user && (pathname === "/" || pathname === "/login" || pathname === "/register")) {
    const role = user.app_metadata?.role;
    let destination: string;
    if (role && !(await hasConsented(supabase, user.id))) {
      destination = "/consent";
    } else {
      destination = getPostAuthRedirect(role);
    }
    if (destination !== pathname) {
      return withRefreshedCookies(response, NextResponse.redirect(new URL(destination, request.url)));
    }
  }

  if (!user && pathname === "/") {
    return withRefreshedCookies(response, NextResponse.redirect(new URL("/register", request.url)));
  }

  return response;
}
