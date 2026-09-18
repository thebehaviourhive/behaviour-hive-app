// Silo 2 placeholders (migration 0244). One generic table
// (clinical_plans), five plan types -- this is the one place a
// plan_type gets a display label, matching SOURCE_DOCUMENT_LABELS'
// own established role for source_document_type in
// passportClinicalContent.ts. clinical_artefact_types itself carries
// no label column at all -- deliberately, per that table's own shape --
// so every future plan type gets its label added here, nowhere else.
export type PlanType = "crisis_plan" | "sensory_diet_plan" | "aac_plan" | "care_plan" | "student_support_plan";

export const PLAN_TYPES: PlanType[] = ["crisis_plan", "sensory_diet_plan", "aac_plan", "care_plan", "student_support_plan"];

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  crisis_plan: "Crisis Management Plan",
  sensory_diet_plan: "Sensory Diet",
  aac_plan: "AAC / Communication Plan",
  care_plan: "Care Plan",
  // Not "IEP" and not "Statutory Plan" -- IEPs have never been
  // statutory in Ireland (the EPSEN Act's own IEP provisions were
  // never commenced). The real, current structure is the Student
  // Support Plan, at three NEPS Continuum of Support tiers (Classroom
  // Support, School Support, School Support Plus) -- "IEP" survives
  // only as informal shorthand at the top tier, and is never used as
  // this label for exactly the reason it was never used as the schema
  // key (see migration 0244's own header).
  student_support_plan: "Student Support Plan",
};
