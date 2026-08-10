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
}

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

export type AflsScoreValue = "independent" | "assisted" | "unable" | "na";

export interface AflsItemScore {
  itemId: string;
  score: AflsScoreValue;
}

// Keyed by domain name (matches fba_instruments' AFLS "category" field
// exactly, so scoring can look an item up by domain without translation).
export type AflsScoresData = Record<string, AflsItemScore[]>;

export interface FbaAflsData {
  id: string;
  fbaId: string;
  scoresData: AflsScoresData;
  summary: string | null;
}

export interface InstrumentItem {
  id: string;
  text: string;
  answer_type: "rating_scale" | "free_text" | "afls_scale";
  scale?: string[];
  category?: string;
}

export interface FbaInstrument {
  id: string;
  instrumentType: "qabf" | "mas" | "open_ended" | "afls";
  version: number;
  items: InstrumentItem[];
}

export const AFLS_DOMAINS = [
  "Self-Management",
  "Basic Communication",
  "Dressing",
  "Toileting",
  "Grooming",
  "Bathing",
  "Health/Safety & First Aid",
  "Nighttime Routines",
] as const;

// ============================================================
// Stage 2 -- the questionnaire engine
// ============================================================

// fba_instrument_requests.instrument_type is a stricter subset of
// FbaInstrument.instrumentType -- AFLS is clinician-self-scored and
// never sent to a recipient (Stage 1 decision, unchanged).
export type SendableInstrumentType = "qabf" | "mas" | "open_ended";

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
  instrumentType: SendableInstrumentType;
  recipientId: string;
  recipientName: string;
  recipientRole: RecipientRole;
  status: InstrumentRequestStatus;
  responsesData: InstrumentResponsesData;
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
  instrumentType: SendableInstrumentType;
  status: InstrumentRequestStatus;
  childName: string;
  clinicianName: string;
  createdAt: string;
}

export const INSTRUMENT_LABELS: Record<SendableInstrumentType, string> = {
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
