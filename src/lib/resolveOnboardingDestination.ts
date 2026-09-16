import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { hasConsented } from "@/lib/hasConsented";
import { hasJoined } from "@/lib/hasJoined";

// The single source of truth for "where does this signed-in user go
// right now" -- role -> joined? -> consented? -> dashboard. Before the
// onboarding restructure this was a two-way branch (consented or not)
// hand-copied three times (src/app/page.tsx, src/lib/supabase/proxy.ts,
// useRequireRole.ts); adding a third state (joined vs. not) to two of
// those copies and not the third is exactly the kind of drift that lets
// a bug hide until a genuinely new signup hits it. page.tsx and proxy.ts
// both call this now instead of their own hand-written logic.
// useRequireRole keeps its own shape (it redirects mid-render rather
// than returning a URL to redirect to), but its consent branch is the
// same rule expressed inline.
//
// A pure function of LIVE state, deliberately -- role from the JWT,
// "joined" and "consented" always freshly queried, never cached or
// assumed. This is what lets a user caught mid-flight by this exact
// deploy (signed up under the old order, not yet consented, no code
// entered) land in the right place on their very next page load, with
// no migration or special-casing needed.
export async function resolveOnboardingDestination(
  supabase: SupabaseClient,
  user: User
): Promise<string> {
  const role = user.app_metadata?.role;
  if (!role) return "/role-select";

  const joined = await hasJoined(supabase, user.id, role);
  if (!joined) {
    return role === "clinician" ? "/clinician/specialty" : "/role-select";
  }

  const consented = await hasConsented(supabase, user.id);
  if (!consented) return "/consent";

  return getPostAuthRedirect(role);
}
