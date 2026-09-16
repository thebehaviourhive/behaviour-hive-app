import type { SupabaseClient } from "@supabase/supabase-js";

// "Joined" is role-shaped, not one query: staff have entered a real
// institution code (any institution_staff row, active or still
// pending approval -- both are genuinely past code-entry, which is
// the only thing this checks); an independent clinician has picked a
// specialty (select_clinician_specialty()'s own upsert target,
// clinicians.user_id); a parent has no code-entry precondition before
// consent at all, today or after this change -- see the onboarding
// restructure plan for why parents are deliberately excluded here.
export async function hasJoined(
  supabase: SupabaseClient,
  userId: string,
  role: string
): Promise<boolean> {
  if (role === "class_teacher" || role === "sna" || role === "principal") {
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
    const { data, error } = await supabase
      .from("clinicians")
      .select("id")
      .eq("user_id", userId)
      .not("specialty", "is", null)
      .maybeSingle();
    if (error) return false;
    return data !== null;
  }

  // parent, or any unrecognised role -- no precondition.
  return true;
}
