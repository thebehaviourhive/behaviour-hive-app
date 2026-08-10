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

  // Section 8 -- Direct Assessment
  onSiteObservations?: string;
  communityParticipation?: string;

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
