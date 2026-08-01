import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPostAuthRedirect } from "@/lib/roleRedirect";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const next = getPostAuthRedirect(data.user?.app_metadata?.role);
      return NextResponse.redirect(`${origin}${next}`);
    }

    return NextResponse.redirect(
      `${origin}/login?error=auth-callback-failed&reason=${encodeURIComponent(error.message)}`
    );
  }

  // No `code` query param — Supabase may have used the implicit flow
  // instead of PKCE (tokens/errors arrive in the URL hash fragment, which
  // a server route can never see), or the link may already have been
  // consumed (e.g. pre-fetched by a mail client's link scanner) with the
  // resulting error also only present in the hash. Hand off to a client
  // page that can actually read window.location.hash.
  return NextResponse.redirect(`${origin}/auth/callback/complete`);
}
