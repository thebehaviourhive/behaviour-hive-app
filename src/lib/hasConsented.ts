import type { SupabaseClient } from "@supabase/supabase-js";

// The one true "has this account completed consent" check -- a single
// row existing in the append-only consents table (see
// 0001_create_consents_table.sql). Shared by every gate that needs to
// know this: useRequireRole (protects every role-gated page in the
// app), the root route's post-auth redirect, and the consent screen's
// own "already done, don't ask again" check.
//
// CRITICAL BUG root cause: no such check existed anywhere before this --
// role alone (set at role-select, one step BEFORE consent) was treated
// as sufficient to route a user through every downstream page, and nothing
// ever separately verified consent had actually been confirmed. This
// function exists to close that gap everywhere at once, not just at the
// one entry point (the privacy policy page's Back button) where it was
// first found.
export async function hasConsented(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("consents")
    .select("id")
    .eq("user_id", userId)
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
