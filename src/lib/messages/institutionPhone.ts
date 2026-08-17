import type { SupabaseClient } from "@supabase/supabase-js";

// The compose sheet's emergency-boundary footer wants a phone number to
// offer as a tap-to-call fallback. Best-effort only -- a missing link or
// missing phone just means the footer falls back to plain text, never a
// blocker for composing. Shared by every surface that mounts
// ComposeMessageSheet for a single passport (parent, teacher's per-child
// tab, clinician's Clinical File tab) instead of re-deriving this same
// two-step lookup in each one.
export async function fetchApprovedInstitutionPhone(
  supabase: SupabaseClient,
  passportId: string
): Promise<string | null> {
  const { data: link } = await supabase
    .from("passport_institution_links")
    .select("institution_id")
    .eq("passport_id", passportId)
    .eq("approved_by_parent", true)
    .limit(1)
    .maybeSingle();

  if (!link?.institution_id) return null;

  const { data: institution } = await supabase
    .from("institutions")
    .select("phone")
    .eq("id", link.institution_id)
    .maybeSingle();

  return institution?.phone ?? null;
}
