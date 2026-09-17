import type { InstitutionType } from "@/lib/institutionType";

// PRD 5 Stage 1: the ONE place a role's display label is decided.
// Before this, the same role -> label mapping was hand-copied across
// nine separate files in TypeScript plus a tenth copy embedded
// directly in SQL (get_principal_activity_feed()) -- and it had
// already drifted (class_teacher rendered as "Class Teacher" in five
// places and "Teacher" in three others; one copy was missing
// principal/institution_admin entirely and silently rendered the raw
// stored value to a user). A function alone doesn't stop that -- one
// already existed in spirit (nothing forced anyone to write a ninth
// copy instead of finding the first eight) -- so every one of those
// nine TypeScript maps is deleted as part of this change, not left
// importable alongside this one. There is nothing left to copy from.
//
// Every institution_staff role value this schema has ever allowed
// (institution_staff_role_check, migration 0203) -- 'clinician' is on
// this list too now: PRD 5 Stage 2 resolved that a clinic practitioner
// IS an institution_staff row (institution_staff.role = 'clinician'),
// reusing membership exactly as class_teacher/sna already do, not the
// separate external/per-child clinician_access-only relationship a
// school's own engaged clinician still uses. 'clinical_lead' and
// 'clinic_admin' are the two genuinely new values Stage 2 introduced.
export type Role =
  | "class_teacher"
  | "sna"
  | "principal"
  | "institution_admin"
  | "clinician"
  | "clinical_lead"
  | "clinic_admin";

export type VocabularyOverrides = Record<string, string>;

// Stable override keys, one per role -- what
// institution_vocabulary_overrides.key holds for a role-label
// override. A separate namespace from the Role type itself so a
// future non-role override (an institution noun, a child noun) can
// use this same table without colliding with a role key.
const ROLE_OVERRIDE_KEY: Record<Role, string> = {
  class_teacher: "role_class_teacher",
  sna: "role_sna",
  principal: "role_principal",
  institution_admin: "role_institution_admin",
  clinician: "role_clinician",
  clinical_lead: "role_clinical_lead",
  clinic_admin: "role_clinic_admin",
};

// The type-driven default. School labels are what every real
// institution has shown since before this table existed -- unchanged
// wording, just centralised. Clinic labels are PRD 5's own decided
// vocabulary (section 9), quoted directly, not invented here: two
// roles reused because the shape genuinely matches (principal/
// clinician), two roles get real values because forcing them into
// school words would be wrong (clinical_lead has no school
// equivalent at all; clinic_admin is not an sna -- "broad access to
// little" versus "deep access to few"). class_teacher/sna have no
// clinic default -- PRD section 9's own vocabulary table marks them
// "not used by clinics"; falling through to the school label for a
// value that can never exist at a clinic institution is harmless and
// intentionally left rather than special-cased. institution_admin
// likewise has no clinic default (a legacy value with no clinic
// equivalent named in the PRD) -- falls through to its school label.
const ROLE_LABEL_DEFAULT: Record<InstitutionType, Partial<Record<Role, string>>> = {
  school: {
    class_teacher: "Class Teacher",
    sna: "SNA",
    principal: "Principal",
    institution_admin: "Institution Admin",
    clinician: "Clinician",
  },
  clinic: {
    principal: "Clinical Director",
    clinician: "Practitioner",
    clinical_lead: "Clinical Lead",
    clinic_admin: "Admin",
  },
};

// getRoleLabel is the whole translation surface for Stage 1: type
// gives the default (PRD 5 section 2), an override replaces it when
// the institution has set one (section 9's "one translation function,
// every surface"). overrides is optional and keyed by
// institution_vocabulary_overrides.key -- pass the institution's own
// override map (as returned by useInstitutionType/
// usePassportInstitutionVocabulary) when it's available; omit it
// entirely at a call site that has no institution context to give
// (there is none today -- every real call site resolves one).
export function getRoleLabel(
  role: string,
  institutionType: InstitutionType,
  overrides?: VocabularyOverrides
): string {
  if (!isRole(role)) {
    // A role value this function doesn't recognise (shouldn't happen
    // against a real institution_staff/clinicians row) -- return the
    // raw value rather than throwing, matching every one of the
    // deleted maps' own `?? role` fallback. Never silently blank.
    return role;
  }

  const overrideKey = ROLE_OVERRIDE_KEY[role];
  const override = overrides?.[overrideKey];
  if (override) return override;

  return ROLE_LABEL_DEFAULT[institutionType][role] ?? ROLE_LABEL_DEFAULT.school[role] ?? role;
}

function isRole(value: string): value is Role {
  return value in ROLE_OVERRIDE_KEY;
}
