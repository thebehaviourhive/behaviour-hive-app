// Role-aware copy and options for the ABC Incident Logger, kept as one
// dictionary rather than scattered if/else blocks so a new role is a new
// entry here, not a hunt through ABCLogger.tsx and ABCTimeline.tsx.
//
// Everything that reads from these (ABCLogger's step content, ABCTimeline's
// footer/reporter-filter labels) picks up a new entry automatically.
export type ABCLoggerRole = "parent" | "class_teacher" | "clinician" | "sna";

// Vocabulary refresh (2026-08): every chip step's "Other" option is now
// literally labelled "Other (please describe)" rather than a bare
// "Other" with the ask implied by the helper text alone. Exported as one
// constant and used everywhere a chip-selection array is checked for it
// (ABCLogger's validation/submit, ABCTimeline's and AbcIncidentCard's
// formatChain/formatList) so the literal string lives in exactly one
// place -- a future copy tweak can't silently desync a check.
export const OTHER_OPTION = "Other (please describe)";

export interface ABCChipStepConfig {
  label: string;
  helper: string;
  options: string[];
}

export interface ABCRoleConfig {
  intensityLabel: string;
  antecedent: ABCChipStepConfig;
  behaviour: ABCChipStepConfig;
  consequence: ABCChipStepConfig;
  // Parent-only, pre-existing free-text "anything else" box. Every other
  // role never had this -- unaffected by the vocabulary refresh, so it
  // stays a plain optional per-role addendum rather than part of the
  // step4Extra union it used to share with perceivedFunction (see the
  // note on PERCEIVED_FUNCTION_QUESTION below for why that union is
  // gone).
  notesLabel?: string;
}

// Vocabulary refresh (2026-08): unified word-for-word across all four
// role tracks per the brief -- the previous per-role split (parent's
// softer tone vs. teacher/SNA/clinician's clinical tone, plus two
// clinician-only options -- "Social conflict" antecedent, "Self-injurious
// behaviour") is retired. "Self-injury" survives in the unified list;
// "Social conflict" does not appear in the new vocabulary and is dropped
// -- flagged for clinical review in the shipping report, not silently
// lost.
const UNIFIED_ANTECEDENT: ABCChipStepConfig = {
  label: "Antecedent (Trigger)",
  helper: "What happened immediately before the behaviour occurred?",
  options: [
    "Asked to do something",
    "Transition to new activity",
    "Transition to new location",
    "Told an item wasn't available",
    "Told a location wasn't available",
    "Told an activity wasn't available",
    "A person entered the environment",
    "A person left the environment",
    "Item removed",
    "Loud noise",
    OTHER_OPTION,
  ],
};

const UNIFIED_BEHAVIOUR: ABCChipStepConfig = {
  label: "Observable behaviour",
  helper: "Please describe the behaviour the child engaged in",
  options: [
    "Hitting",
    "Kicking",
    "Breaking items",
    "Running away",
    "Shouting/screaming",
    "Verbal insults",
    "Self-injury",
    "Throwing items",
    "Spitting",
    "Pulling hair",
    "Dropping to the ground",
    "Scratching",
    OTHER_OPTION,
  ],
};

const UNIFIED_CONSEQUENCE: ABCChipStepConfig = {
  label: "Consequence (Outcome)",
  helper: "What happened immediately after the behaviour?",
  options: [
    "Task removed or delayed",
    "1:1 attention provided",
    "Distracted them",
    "Tried to calm and soothe them",
    "Argued with them",
    "Ignored",
    "Adult walked away",
    "Child walked away",
    "Gave item to the child",
    "Removed item from the child",
    "Cleared the environment",
    OTHER_OPTION,
  ],
};

export const ABC_ROLE_CONFIG: Record<ABCLoggerRole, ABCRoleConfig> = {
  parent: {
    intensityLabel: "How intense was it?",
    antecedent: UNIFIED_ANTECEDENT,
    behaviour: UNIFIED_BEHAVIOUR,
    consequence: UNIFIED_CONSEQUENCE,
    notesLabel: "Anything else you want to add?",
  },
  class_teacher: {
    intensityLabel: "Intensity Level",
    antecedent: UNIFIED_ANTECEDENT,
    behaviour: UNIFIED_BEHAVIOUR,
    consequence: UNIFIED_CONSEQUENCE,
  },
  // SNA reuses the class_teacher config verbatim -- same "extend, don't
  // fork" reasoning applied elsewhere in this file also applies here.
  sna: {
    intensityLabel: "Intensity Level",
    antecedent: UNIFIED_ANTECEDENT,
    behaviour: UNIFIED_BEHAVIOUR,
    consequence: UNIFIED_CONSEQUENCE,
  },
  clinician: {
    intensityLabel: "Intensity Level",
    antecedent: UNIFIED_ANTECEDENT,
    behaviour: UNIFIED_BEHAVIOUR,
    consequence: UNIFIED_CONSEQUENCE,
  },
};

export const ABC_ROLE_DISPLAY_LABEL: Record<ABCLoggerRole, string> = {
  parent: "Parent",
  class_teacher: "Teacher",
  clinician: "Clinician",
  sna: "SNA",
};

// ============================================================
// "Why do you think this happened?" -- perceived_function.
// ============================================================
// Available to every role now (previously teacher/SNA/clinician only;
// parent's step 4 was a free-text "notes" box with no function question
// at all). One canonical question, not a per-role config entry, since
// the copy is now identical everywhere -- unlike the chip steps above,
// there's no per-role variant to preserve.
//
// Values: 'sensory' is relabelled to 'automatic' (migration 0067,
// value-preserving rename of the same clinical concept) and 'other' is
// new, paired with perceived_function_other for its free text -- same
// pattern antecedent_other/behaviour_other/consequence_other already
// use. This single array is the source for BOTH the input chips here
// AND the clinician Progress tab's function-breakdown chart bar labels
// (lib/progress/function.ts) -- one label, two renderers, no drift.
export const PERCEIVED_FUNCTION_OPTIONS: { value: string; label: string }[] = [
  { value: "attention", label: "To get your attention" },
  { value: "escape", label: "To get out of doing something / going somewhere" },
  { value: "tangible", label: "To get access to something" },
  { value: "automatic", label: "To regulate themselves" },
  { value: "other", label: "Other (please describe)" },
];

export const PERCEIVED_FUNCTION_LABELS: Record<string, string> = Object.fromEntries(
  PERCEIVED_FUNCTION_OPTIONS.map((o) => [o.value, o.label])
);

export const PERCEIVED_FUNCTION_QUESTION = {
  label: "Why do you think this happened?",
  // Protection model (i): perceived_function stays gated to verified,
  // actively-linked clinicians only, regardless of who authored the
  // log -- so the honest, uniform framing here is "shared with the
  // clinical team", not "visible on your own log later". Applies
  // identically to every role, clinician included -- see the ABC vocab
  // refresh report for why that's a deliberate simplification, not an
  // oversight.
  helper:
    "Optional — your answer is shared with the clinical team to help them understand patterns. It won't appear on the log.",
};

// ============================================================
// Sensory signals -- new, optional block after the Consequence step.
// One canonical vocabulary, all roles, per the brief. Deliberately
// distinct from the passport's own Section D sensory_seeks/
// sensory_avoids (profile-level, one-time, broad modality categories)
// -- this is per-incident, specific observable behaviour. The block's
// own helper copy in ABCLogger.tsx carries that disambiguation to the
// user; these arrays are just the vocabulary.
// ============================================================
export const SENSORY_SOUGHT_OPTIONS: string[] = [
  "Movement (vestibular)",
  "Deep pressure",
  "Rough housing",
  "Touching everything",
  "Messy play",
  "Fidgeting",
  "Rubbing their skin",
  "Chewing items",
  "Mouthing items",
  "Vocal stimming",
  "Seeking noise",
  "Staring at moving items",
  "Seeking light",
  "Smelling things",
  "Holding urine or bowels",
  "Overeating",
  OTHER_OPTION,
];

export const SENSORY_AVOIDED_OPTIONS: string[] = [
  "Covering ears",
  "Fleeing crowded areas",
  "Refusing specific clothing",
  "Not wanting to be touched",
  "Wanting to be clean",
  "Eating selective foods (textures, temperatures, colours)",
  "Avoiding swings",
  "Anxious on uneven surfaces",
  "Motion sickness",
  "Avoiding eye contact",
  "Covering eyes",
  "Avoiding certain smells",
  "Using bathroom often",
  OTHER_OPTION,
];
