export function getPostAuthRedirect(role: string | null | undefined): string {
  switch (role) {
    case "parent":
      return "/parent-dashboard";
    case "class_teacher":
      return "/teacher/dashboard";
    case "sna":
      return "/sna/passports";
    case "clinician":
      return "/clinician/dashboard";
    case "principal":
      return "/principal/dashboard";
    // clinical_lead/clinic_admin -- FOUND MISSING 21 Sept 2026, live,
    // by Daniel's own first attempt to join a clinic he'd just created.
    // Before this, both fell through to the default case and landed a
    // genuinely joined, consented user back on /role-select -- code
    // entry, indistinguishable from never having signed up at all. See
    // CLAUDE.md's own dedicated entry on this finding and the standing
    // lesson it produced: a new institution TYPE, like a new ROLE, is
    // only proven by signing up through the real screens as each of
    // its roles -- every downstream RLS/RPC/consent screen for these
    // two roles was already correct; nothing had ever exercised the
    // signup-to-landing path itself. Neither role has its own real
    // dashboard yet (a deliberate, separate product decision -- see
    // CLAUDE.md's "clinical_lead ROLE HAS NO CLIENT SURFACE" entry) --
    // both land on a small honest holding page instead of looping.
    case "clinical_lead":
      return "/clinical-lead/dashboard";
    case "clinic_admin":
      return "/clinic-admin/dashboard";
    // PRD 11 Stage 2 -- added from the start, deliberately, rather
    // than found missing live the way clinical_lead/clinic_admin were
    // (the entry immediately above is the standing lesson this follows
    // now, not one this repeats).
    case "centre_manager":
      return "/centre/dashboard";
    case "care_staff":
      return "/care/dashboard";
    default:
      return "/role-select";
  }
}
