import type { SupabaseClient } from "@supabase/supabase-js";
import { CURRENT_CONSENT_VERSION } from "@/lib/consentVersion";

// The one true "has this account completed consent, AT THE CURRENT
// VERSION" check -- a row in the append-only consents table (see
// 0001_create_consents_table.sql) whose consent_version is at least
// the current one. Shared by every gate that needs to know this:
// useRequireRole (protects every role-gated page in the app), the root
// route's post-auth redirect, and the consent screen's own "already
// done, don't ask again" check.
//
// CRITICAL BUG root cause: no such check existed anywhere before this --
// role alone (set at role-select, one step BEFORE consent) was treated
// as sufficient to route a user through every downstream page, and nothing
// ever separately verified consent had actually been confirmed. This
// function exists to close that gap everywhere at once, not just at the
// one entry point (the privacy policy page's Back button) where it was
// first found.
//
// Version-checked, not just "any row exists", since the consent/
// agreement screens rebuild (CONSENT_VERSION 1 -> 2): a row recorded
// against the OLD copy (which told parents things that were false)
// does not cover the new, true copy. Someone who already consented
// under v1 is shown the new v2 screen once, same as a first-time
// signup -- deliberate, not a bug, and low-risk: only 10 real rows
// existed at the time of this change, all v1.
export async function hasConsented(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("consents")
    .select("id")
    .eq("user_id", userId)
    .gte("consent_version", CURRENT_CONSENT_VERSION)
    .limit(1)
    .maybeSingle();

  if (error) {
    // Fail closed: if we can't confirm consent, treat it as not given
    // rather than letting a transient read error silently wave someone
    // through. A false negative just re-shows the consent screen (mildly
    // annoying); a false positive is the exact bug this exists to close.
    console.error("Failed to check consent status:", error);
    return false;
  }

  return data !== null;
}
