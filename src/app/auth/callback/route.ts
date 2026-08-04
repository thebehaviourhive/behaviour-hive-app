import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getPostAuthRedirect } from "@/lib/roleRedirect";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const next = getPostAuthRedirect(data.user?.app_metadata?.role);
      return NextResponse.redirect(`${origin}${next}`);
    }

    return NextResponse.redirect(
      `${origin}/login?error=auth-callback-failed&reason=${encodeURIComponent(error.message)}`
    );
  }

  // token_hash + type: the confirmation email links directly to this route
  // (via {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=
  // {{ .Type }} in the Supabase email template) rather than through
  // Supabase's own hosted /auth/v1/verify endpoint. That's what keeps the
  // tapped link on our own domain, which iOS requires to route a Mail-app
  // tap into the installed PWA instead of Safari -- a link that first
  // lands on supabase.co never matches the PWA's scope, no matter where
  // it redirects to afterward. verifyOtp() does the same server-side
  // token verification Supabase's hosted endpoint would otherwise do.
  if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (!error) {
      // A password-recovery link should land the user on the "set a new
      // password" screen, not straight into their dashboard as if this
      // were an ordinary sign-in -- the whole point of the link was that
      // they can't sign in with their old password.
      const next =
        type === "recovery"
          ? "/reset-password"
          : getPostAuthRedirect(data.user?.app_metadata?.role);
      return NextResponse.redirect(`${origin}${next}`);
    }

    return NextResponse.redirect(
      `${origin}/login?error=auth-callback-failed&reason=${encodeURIComponent(error.message)}`
    );
  }

  // No `code` or `token_hash` query param — Supabase may have used the
  // implicit flow instead (tokens/errors arrive in the URL hash fragment,
  // which a server route can never see), or the link may already have
  // been consumed (e.g. pre-fetched by a mail client's link scanner) with
  // the resulting error also only present in the hash. Hand off to a
  // client page that can actually read window.location.hash.
  return NextResponse.redirect(`${origin}/auth/callback/complete`);
}
