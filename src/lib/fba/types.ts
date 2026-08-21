// Shared types for the FBA module. content_data mirrors the shape of
// fba_reports.content_data exactly -- every field optional, since a
// fresh draft's JSONB starts as {} and each section only ever writes
// its own keys.

export type FbaStatus = "draft" | "in_progress" | "completed";

export interface TargetBehaviourEntry {
  id: string;
  name: string;
  operationalDefinition: string;
  howItPresents: string;
}

export interface TriggerEntry {
  id: string;
  title: string;
  description: string;
}

export interface SettingEventEntry {
  id: string;
  title: string;
  description: string;
}

export interface StrategyEntry {
  id: string;
  title: string;
  details: string[];
  // Optional tag into strategy_types (migration 0055), for cross-child
  // grouping in the Strategy Effectiveness / Strategy Insights features.
  // Untagged strategies remain fully valid -- they group as "Untagged"
  // in every aggregate rather than being treated as incomplete.
  strategyType?: string;
}

// One clinician-transcribed Open-Ended FAI interview: item id (see
// FAI_ITEM_IDS/FAI_ITEMS) -> the respondent's answer. Item 1's answer is
// still a plain string here (an ISO yyyy-mm-dd date), matching how
// reportDate/signOffDate are stored elsewhere in content_data.
export interface FaiInterview {
  id: string;
  answers: Record<string, string>;
}

// The four items every interview form pre-fills or reads a respondent's
// identity from -- named rather than left as magic "fai-N" strings
// anywhere pre-fill or respondent-name/relation extraction happens.
export const FAI_ITEM_IDS = {
  date: "fai-1",
  childNameAndAge: "fai-2",
  respondentName: "fai-3",
  respondentRelation: "fai-4",
} as const;

export interface FbaContentData {
  // Section 1 -- Client Profile
  reportDate?: string;
  residence?: string;

  // Section 2 -- Clinical Overview & Primary Findings
  clinicalOverview?: string;

  // Section 3 -- Assessment Methods
  assessmentMethods?: string[];
  assessmentMethodsOther?: string;

  // Section 4 -- Introduction & History of Behaviour
  introductionHistory?: string;

  // Section 5 -- Target Behaviours
  targetBehaviours?: TargetBehaviourEntry[];

  // Section 6 -- Co-Varying Behaviours, Precursors, Triggers & Setting Events
  coVaryingBehaviours?: string;
  precursors?: string;
  triggers?: TriggerEntry[];
  settingEvents?: SettingEventEntry[];

  // Section 7 -- Indirect Assessment
  openEndedInterviewNotes?: string;
  // Clinician-transcribed Open-Ended FAI interviews -- one per
  // respondent (parent, teacher, SNA, etc.), recorded live by the
  // clinician inside the workspace rather than sent out. Not the same
  // thing as the old sendable open_ended instrument (still present for
  // reading the one legacy test response, never writable again -- see
  // InstrumentRequestType).
  faiInterviews?: FaiInterview[];
  // Keyed by fba_instrument_requests.id -- the clinician's written
  // interpretation of one completed QABF/MAS result. Per-request rather
  // than one shared field, since Section 7 can hold several completions
  // of the same instrument (e.g. QABF from both parent and teacher),
  // each needing its own interpretation.
  instrumentInterpretations?: Record<string, string>;
  // Denormalized snapshot of fba_instrument_requests, refreshed whenever
  // Section 7 loads and something's changed. Exists so
  // getSectionCompleteness can stay a pure function of content_data
  // alone -- it has no DB access of its own -- rather than threading a
  // request list through the whole section-list call chain.
  indirectAssessmentSummary?: { sentCount: number; completedCount: number };

  // Section 8 -- Direct Assessment
  onSiteObservations?: string;
  communityParticipation?: string;
  // ABC pull: a clinician-set assessment window, re-queried against
  // abc_logs (read-only, via the existing get_abc_logs RPC) whenever it
  // changes.
  abcRangeStart?: string;
  abcRangeEnd?: string;
  // Function tags are FBA analysis data, not modifications to the
  // underlying log -- keyed by abc_logs.id, entirely separate from the
  // abc_logs table itself.
  abcFunctionTags?: Record<string, AbcHypothesisedFunction>;
  abcInterpretation?: string;
  // Same denormalization rationale as indirectAssessmentSummary above --
  // total logs in the current range vs. how many are tagged.
  abcAnalysisSummary?: { totalLogsInRange: number; taggedCount: number };

  // Section 9 -- Hypothesised Behavioural Functions
  hypothesisedFunctions?: string;

  // Section 10 -- Consent, Assent & Social Validity
  consentAssentSocialValidity?: string;

  // Section 12 -- Recommendations
  recommendationsHome?: StrategyEntry[];
  recommendationsSchool?: StrategyEntry[];
  recommendationsShared?: StrategyEntry[];

  // Section 13 -- Conclusion
  conclusion?: string;
  signOffName?: string;
  signOffCredentials?: string;
  signOffDate?: string;
}

export interface FbaReport {
  id: string;
  passportId: string;
  clinicianId: string;
  status: FbaStatus;
  contentData: FbaContentData;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// AFLS REBUILD (migration 0060): the real 225-task item bank replaces
// the old universal independent/assisted/unable/na 4-state pick. Each
// task now scores numerically against ITS OWN scale (0..maxScore,
// maxScore is 2 or 4) -- a task-specific range, not a fixed one --
// plus an "NA" option gated by naRule where the paper protocol calls
// for it. fba_afls_data (the old one-row-per-FBA qualitative table) is
// gone; afls_assessments (multi-row per FBA) is its replacement.

export type AflsNaRule = "male_na" | "female_na" | "na_if_talks";

// Shown as a small hint next to a task's chips when naRule is present
// -- never auto-applied from any profile field (there is no sex/gender
// field on the passport by design); the clinician taps NA manually,
// per the paper protocol.
export const AFLS_NA_RULE_HINTS: Record<AflsNaRule, string> = {
  male_na: "NA for male learners",
  female_na: "NA for female learners",
  na_if_talks: "NA if learner communicates by talking",
};

// One task's recorded value: a point score from 0..maxScore, or the
// literal "NA". A task with no entry at all is "unscored" -- a
// display-only third state, never itself stored.
export type AflsTaskScore = number | "NA";

// Keyed by task code (e.g. "SM6"), matching fba_instruments' AFLS item
// `id` field exactly. Unscored tasks are simply absent -- partial
// assessments are valid, per the brief.
export type AflsScores = Record<string, AflsTaskScore>;

// One row of afls_assessments -- one transcribed paper assessment.
// Multiple per FBA over time (the paper protocol's own repeated-
// assessment design).
export interface AflsAssessment {
  id: string;
  fbaId: string;
  // yyyy-mm-dd. Editable -- paper assessments are transcribed
  // retrospectively, so this rarely matches the day it's typed in.
  assessmentDate: string;
  assessorName: string;
  scores: AflsScores;
  // CHANGE 3 (2026-08-21, migration 0066): free-text clinician
  // narrative per domain, keyed by AFLS domain CODE (e.g. "SM") --
  // same keying convention as `scores`' task codes. A missing key
  // means no comment recorded for that domain, same "absent = not yet
  // touched" convention as an unscored task.
  domainComments: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface InstrumentItem {
  id: string;
  text: string;
  answer_type: "rating_scale" | "free_text" | "afls_scale" | "date";
  scale?: string[];
  // For AFLS items, this is the domain CODE (e.g. "SM"), not the
  // display name -- see AFLS_DOMAINS below for the code -> name map.
  category?: string;
  // AFLS items only: the task's own 0..maxScore scale (2 or 4).
  maxScore?: number;
  // AFLS items only: which learners this task doesn't apply to, if any.
  naRule?: AflsNaRule;
}

export interface FbaInstrument {
  id: string;
  instrumentType: "qabf" | "mas" | "open_ended" | "afls";
  version: number;
  items: InstrumentItem[];
  // Nullable, generic to any instrument (not open_ended-specific) --
  // shown only on the finalized reader view and PDF, never in the
  // clinician's own editing UI.
  attribution?: string | null;
}

// The 8 fixed domains from the paper protocol itself -- structural
// identity (code + display name + order), not clinical item content,
// so this stays a code constant even though item text/scales are data.
// Display names match scripts/afls/afls_items.json verbatim.
export const AFLS_DOMAINS: { code: string; name: string }[] = [
  { code: "SM", name: "Self-Management" },
  { code: "BC", name: "Basic Communication" },
  { code: "DR", name: "Dressing" },
  { code: "TL", name: "Toileting" },
  { code: "GR", name: "Grooming" },
  { code: "BT", name: "Bathing" },
  { code: "HS", name: "Health, Safety & First Aid" },
  { code: "NR", name: "Nighttime Routines" },
];

// Total tasks across all 8 domains (migration 0060) -- used to tell
// "partially scored" apart from "fully scored" for completeness.
export const AFLS_TOTAL_TASKS = 225;

// ============================================================
// Stage 2 -- the questionnaire engine
// ============================================================

// What the Send Questionnaire flow may create GOING FORWARD. Open-Ended
// was removed from this (migration 0044): it's now a clinician-
// transcribed form (FaiInterview), never sent to a recipient. The one
// pre-existing completed open_ended request from before that change
// still exists in the table and must keep rendering -- that's what the
// broader InstrumentRequestType below is for.
export type SendableInstrumentType = "qabf" | "mas";

// Every instrument_type fba_instrument_requests can actually contain,
// including the now-unsendable "open_ended" -- used anywhere a request
// is being READ/rendered rather than created, so the one legacy
// completed response doesn't become a type error waiting to happen.
export type InstrumentRequestType = SendableInstrumentType | "open_ended";

export type InstrumentRequestStatus = "sent" | "in_progress" | "completed";

export type RecipientRole = "parent" | "class_teacher";

export const RECIPIENT_ROLE_LABELS: Record<RecipientRole, string> = {
  parent: "Parent",
  class_teacher: "Teacher",
};

// item id -> answer. Rating-scale items store the chosen scale LABEL
// (e.g. "Often"), not a numeric index -- scoring derives the point
// value via scale.indexOf(answer) against the item's own scale array,
// so a later real-instrument item-bank update can't silently desync
// stored responses from their point values. Free-text items store the
// raw string.
export type InstrumentResponsesData = Record<string, string>;

// The clinician's view of one sent/in-progress/completed request --
// shape of get_fba_instrument_requests()'s return row.
export interface FbaInstrumentRequest {
  id: string;
  instrumentType: InstrumentRequestType;
  recipientId: string;
  recipientName: string;
  recipientRole: RecipientRole;
  status: InstrumentRequestStatus;
  responsesData: InstrumentResponsesData;
  // The per-send instruction line, verbatim as stored -- still carrying
  // the literal "[child name]" token if present. Null for requests sent
  // before this field existed. See resolveInstruction.ts for how every
  // renderer turns this into display text.
  instruction: string | null;
  createdAt: string;
  completedAt: string | null;
  lastRemindedAt: string | null;
}

// The Send Questionnaire picker's candidate list -- shape of
// get_fba_recipient_candidates()'s return row.
export interface FbaRecipientCandidate {
  recipientId: string;
  fullName: string;
  role: RecipientRole;
}

// The recipient's own dashboard-card view of one active request --
// shape of get_my_instrument_requests()'s return row. Deliberately thin
// -- just enough to render the card and drive the completion flow,
// never anything from the FBA itself.
export interface MyInstrumentRequest {
  id: string;
  fbaId: string;
  instrumentType: InstrumentRequestType;
  status: InstrumentRequestStatus;
  childName: string;
  clinicianName: string;
  instruction: string | null;
  createdAt: string;
}

export const INSTRUMENT_LABELS: Record<InstrumentRequestType, string> = {
  qabf: "QABF",
  mas: "MAS",
  open_ended: "Open-Ended Interview",
};

// ============================================================
// Stage 2 -- ABC function tagging (Section 8)
// ============================================================

export type AbcHypothesisedFunction =
  | "escape_avoidance"
  | "access_tangible"
  | "access_location"
  | "remove_person"
  | "attention"
  | "sensory_automatic";

export const ABC_FUNCTION_LABELS: Record<AbcHypothesisedFunction, string> = {
  escape_avoidance: "Escape/Avoidance",
  access_tangible: "Access to Tangible",
  access_location: "Access to Location",
  remove_person: "Remove Person",
  attention: "Attention",
  sensory_automatic: "Sensory/Automatic",
};

export const ABC_FUNCTION_OPTIONS = Object.keys(ABC_FUNCTION_LABELS) as AbcHypothesisedFunction[];
