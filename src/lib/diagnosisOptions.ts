// Canonical diagnosis/neurotype option list for passport Section A --
// single source of truth for both the creation wizard and the section
// edit flow (the same route/component, src/app/passport/section-a/
// page.tsx, handles both) and for DiagnosisSelect's Tier 1/Tier 2
// split. Stored verbatim in passports.diagnoses (text[]), so this is
// additive-only: adding a value here is safe, renaming or removing one
// would silently change what an existing passport's past selection
// means.
//
// One pre-existing finding, resolved (Stage 2, 15 Sept 2026): "Autism"
// and "ASD (Autism Spectrum Disorder)" were two separate stored values
// for what most families mean as the same thing -- flagged and
// deliberately left alone during an earlier presentation-only
// restructure, now deduped on Daniel's own instruction. Migration 0191
// remapped every existing passport's stored selection (exactly one, at
// the time, checked live) from the ASD string to "Autism" -- collapsing
// to one value on any passport that happened to have both -- before
// this option was removed below. "Autism" is the one that survives
// (the shorter, plainer of the two, already Tier 1); the ASD (...)
// string is gone from this list entirely, not just hidden.
//
// One remaining pre-existing finding, still left alone:
// - "No Formal Diagnosis" already existed and is NOT the same thing as
//   either new option added here: "Awaiting Diagnosis" (a family
//   actively pursuing one) and "No diagnosis" (a plain status, added
//   per the brief since neither existed). "No Formal Diagnosis" sits
//   ambiguously between the two -- kept as its own distinct, unchanged
//   Tier 2 option so any existing passport that selected it keeps
//   meaning exactly what it always meant.
export const DIAGNOSIS_OPTIONS: string[] = [
  "ADHD (Attention Deficit Hyperactivity Disorder)",
  "Anxiety",
  "Apraxia",
  "Autism",
  "Awaiting Diagnosis",
  "DLD (Developmental Language Disorder)",
  "DMDD (Disruptive Mood Dysregulation Disorder)",
  "Dyscalculia",
  "Dysgraphia",
  "Dyslexia",
  "Dyspraxia",
  "FASD (Foetal Alcohol Spectrum Disorder)",
  "GDD (Global Developmental Delay)",
  "Intellectual Disability",
  "No diagnosis",
  "No Formal Diagnosis",
  "ODD (Oppositional Defiant Disorder)",
  "PDA (Pathological Demand Avoidance)",
  "Physical Disability",
  "SPD (Sensory Processing Disorder)",
  "Tourette Syndrome",
];

// The free-entry escape hatch -- kept as its own constant (not inside
// DIAGNOSIS_OPTIONS) since it's structurally different: selecting it
// reveals a text field rather than being a value in its own right.
// Always the last item in Tier 2, matching where it sat in the
// original single-tier list.
export const DIAGNOSIS_OTHER = "Other";

// Tier 1: always-visible quick options, in a fixed, deliberate order --
// not alphabetical. Autism/ADHD are this app's two most commonly
// reported conditions; Awaiting Diagnosis/No diagnosis are statuses
// (not conditions) surfaced right alongside them, since a family in
// either position needs to say so just as quickly as a family with a
// confirmed diagnosis. The last three are a PROVISIONAL "next-most-
// common" pick (Sensory Processing, Anxiety, Dyslexia) -- there is no
// selection-usage data yet to justify this specific order beyond "a
// reasonable guess given what families using this app commonly
// report"; revisit once real data exists. Dyspraxia (the other
// candidate this app's brief named) stays in Tier 2, alphabetically
// near the top.
export const TIER_1_DIAGNOSES: string[] = [
  "Autism",
  "ADHD (Attention Deficit Hyperactivity Disorder)",
  "Awaiting Diagnosis",
  "No diagnosis",
  "SPD (Sensory Processing Disorder)",
  "Anxiety",
  "Dyslexia",
];

// Tier 2: every remaining diagnosis, alphabetical, with the free-entry
// "Other" fixed at the end.
export const TIER_2_DIAGNOSES: string[] = [
  ...DIAGNOSIS_OPTIONS.filter((option) => !TIER_1_DIAGNOSES.includes(option)).sort((a, b) =>
    a.localeCompare(b)
  ),
  DIAGNOSIS_OTHER,
];
