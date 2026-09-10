import type { SupabaseClient } from "@supabase/supabase-js";

// The compose sheet's emergency-boundary footer wants a phone number to
// offer as a tap-to-call fallback. Best-effort only -- a missing link or
// missing phone just means the footer falls back to plain text, never a
// blocker for composing. Shared by every surface that mounts
// ComposeMessageSheet for a single passport (parent, teacher's per-child
// tab, clinician's Clinical File tab) instead of re-deriving this same
// lookup in each one.
//
// REAL BUG FIXED (migration 0182): this used to be a raw two-step client
// query -- passport_institution_links WHERE approved_by_parent = true
// LIMIT 1, then institutions -- with no institution_id scoping at all.
// A child with approved links to two institutions got AN institution's
// phone number, not a defined one; Postgres row order isn't a fact to
// build an emergency-contact fallback on. Now a single SECURITY DEFINER
// RPC (get_approved_institution_phone) that resolves the passport's
// CURRENT ACTIVE ENROLMENT (unique by DB constraint, migration 0121) --
// the real "which school is this child at" fact -- rather than an
// approval flag multiple institutions can equally satisfy. Also fixes a
// second, quieter bug the raw-query version had: enrolments' own SELECT
// policy is staff-only, so a parent or clinician calling this directly
// would have gotten zero rows back, RLS-silent; the RPC's own broader
// authorization check (owner, staff with child access, engaged
// clinician, or a linked institution's principal) covers all three
// tracks that actually call this.
export async function fetchApprovedInstitutionPhone(
  supabase: SupabaseClient,
  passportId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_approved_institution_phone", { p_passport_id: passportId });
  if (error) {
    // Best-effort, same posture as before this fix: a failure here
    // never blocks composing, it just means the footer falls back to
    // plain text.
    console.error("Failed to fetch approved institution phone:", error);
    return null;
  }
  return data ?? null;
}
