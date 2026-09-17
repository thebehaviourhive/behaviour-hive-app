import type { SupabaseClient } from "@supabase/supabase-js";

// "Joined" is role-shaped, not one query: school staff have entered a
// real institution code (any institution_staff row, active or still
// pending approval -- both are genuinely past code-entry, which is
// the only thing this checks); a parent has no code-entry precondition
// before consent at all, today or after the onboarding restructure --
// see that work's own plan for why parents are deliberately excluded
// here.
//
// 'clinician' (and, since PRD 5 Stage 2, 'clinical_lead'/'clinic_admin')
// can now reach app_metadata.role two genuinely different ways, and
// "joined" has to recognise both: (a) the manual, Behaviour-Hive-run
// path (scripts/admin/set-clinician-role.mjs) for an institution-
// employed-but-not-yet-institution_staff clinician, or the original
// independent-verification flow -- "joined" there is picking a
// specialty (select_clinician_specialty()'s own upsert target,
// clinicians.user_id); (b) Stage 2's own clinic-institution path -- a
// practitioner/lead/admin who self-linked into institution_staff at a
// real clinic, exactly like school staff. Checking institution_staff
// ALONE for these three roles would wrongly say "not joined" for path
// (a); checking clinicians.specialty ALONE would wrongly say "not
// joined" for a clinic practitioner who joined by code but hasn't
// picked a specialty yet (a separate, later, manual verification step
// -- see CLAUDE.md's own "INSTITUTION-EMPLOYED CLINICIAN VERIFICATION"
// entry). Either one being true means they've joined.
export async function hasJoined(
  supabase: SupabaseClient,
  userId: string,
  role: string
): Promise<boolean> {
  if (
    role === "class_teacher" ||
    role === "sna" ||
    role === "principal" ||
    role === "clinical_lead" ||
    role === "clinic_admin"
  ) {
    const { data, error } = await supabase
      .from("institution_staff")
      .select("id")
      .eq("user_id", userId)
      .is("deactivated_at", null)
      .limit(1)
      .maybeSingle();
    if (error) return false; // fail closed, matching hasConsented()'s own posture
    return data !== null;
  }

  if (role === "clinician") {
    const [staffResult, specialtyResult] = await Promise.all([
      supabase.from("institution_staff").select("id").eq("user_id", userId).is("deactivated_at", null).limit(1).maybeSingle(),
      supabase.from("clinicians").select("id").eq("user_id", userId).not("specialty", "is", null).maybeSingle(),
    ]);
    if (staffResult.error && specialtyResult.error) return false; // fail closed only if BOTH queries themselves failed
    return staffResult.data !== null || specialtyResult.data !== null;
  }

  // parent, or any unrecognised role -- no precondition.
  return true;
}
