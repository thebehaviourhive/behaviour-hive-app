import type { FbaAflsData, FbaContentData } from "./types";

export type SectionCompleteness = "empty" | "partial" | "complete";

export type SectionKind =
  | "clientProfile"
  | "narrative"
  | "assessmentMethods"
  | "targetBehaviours"
  | "triggersSettingEvents"
  | "indirectAssessment"
  | "directAssessment"
  | "afls"
  | "recommendations"
  | "conclusion"
  | "review";

export interface FbaSectionDef {
  number: number;
  slug: string;
  title: string;
  kind: SectionKind;
  // For plain narrative sections, which content_data key holds the text --
  // avoids a 4-way if/else in the completeness function and the section
  // route for the four sections that are otherwise identical in shape.
  narrativeField?: keyof FbaContentData;
}

export const FBA_SECTIONS: FbaSectionDef[] = [
  { number: 1, slug: "1", title: "Client Profile", kind: "clientProfile" },
  {
    number: 2,
    slug: "2",
    title: "Clinical Overview & Primary Findings",
    kind: "narrative",
    narrativeField: "clinicalOverview",
  },
  { number: 3, slug: "3", title: "Assessment Methods", kind: "assessmentMethods" },
  {
    number: 4,
    slug: "4",
    title: "Introduction & History of Behaviour",
    kind: "narrative",
    narrativeField: "introductionHistory",
  },
  { number: 5, slug: "5", title: "Target Behaviours", kind: "targetBehaviours" },
  {
    number: 6,
    slug: "6",
    title: "Co-Varying Behaviours, Precursors, Triggers & Setting Events",
    kind: "triggersSettingEvents",
  },
  { number: 7, slug: "7", title: "Indirect Assessment", kind: "indirectAssessment" },
  { number: 8, slug: "8", title: "Direct Assessment", kind: "directAssessment" },
  {
    number: 9,
    slug: "9",
    title: "Hypothesised Behavioural Functions",
    kind: "narrative",
    narrativeField: "hypothesisedFunctions",
  },
  {
    number: 10,
    slug: "10",
    title: "Consent, Assent & Social Validity",
    kind: "narrative",
    narrativeField: "consentAssentSocialValidity",
  },
  { number: 11, slug: "11", title: "AFLS", kind: "afls" },
  { number: 12, slug: "12", title: "Recommendations", kind: "recommendations" },
  { number: 13, slug: "13", title: "Conclusion", kind: "conclusion" },
  { number: 14, slug: "14", title: "Review & Status", kind: "review" },
];

export function getFbaSection(slug: string): FbaSectionDef | undefined {
  return FBA_SECTIONS.find((s) => s.slug === slug);
}

// Total AFLS items across all 8 domains (8 domains x 8 items, seeded in
// migration 0040) -- used to tell "partially scored" apart from "fully
// scored" for section 11's completeness pill.
const TOTAL_AFLS_ITEMS = 64;

export function getSectionCompleteness(
  section: FbaSectionDef,
  content: FbaContentData,
  afls: FbaAflsData | null
): SectionCompleteness {
  switch (section.kind) {
    case "clientProfile":
      // Report date is auto-set the moment a draft is created (see
      // useFbaReport's initial content_data) -- this section reads as
      // "done" from the start, since everything else is read-only,
      // auto-populated passport data. Residence is a nice-to-add extra,
      // not a completeness gate.
      return content.reportDate ? "complete" : "empty";

    case "narrative": {
      const value = section.narrativeField ? content[section.narrativeField] : undefined;
      return typeof value === "string" && value.trim() ? "complete" : "empty";
    }

    case "assessmentMethods":
      return (content.assessmentMethods?.length ?? 0) > 0 ? "complete" : "empty";

    case "targetBehaviours":
      return (content.targetBehaviours?.length ?? 0) > 0 ? "complete" : "empty";

    case "triggersSettingEvents": {
      const hasNarrative = Boolean(content.coVaryingBehaviours?.trim() || content.precursors?.trim());
      const hasStructured =
        (content.triggers?.length ?? 0) > 0 || (content.settingEvents?.length ?? 0) > 0;
      if (hasNarrative && hasStructured) return "complete";
      if (hasNarrative || hasStructured) return "partial";
      return "empty";
    }

    case "indirectAssessment": {
      // Stage 2: also reflects whether any sent QABF/MAS questionnaires
      // have actually come back, via indirectAssessmentSummary -- a
      // denormalized snapshot of fba_instrument_requests (this function
      // has no DB access of its own, see the section component's own
      // comment on why that snapshot exists).
      //
      // A recorded FAI interview counts the same as the free-text notes
      // field -- it's now the primary way this section gets indirect-
      // assessment content, not a lesser substitute for it. "Recorded"
      // means at least one interview has at least one non-empty answer,
      // not just an empty shell created by tapping [+ Add Interview].
      const hasNarrative = Boolean(content.openEndedInterviewNotes?.trim());
      const hasInterview = (content.faiInterviews ?? []).some((interview) =>
        Object.values(interview.answers).some((answer) => answer?.trim())
      );
      const summary = content.indirectAssessmentSummary;
      const allInstrumentsBack = !summary || summary.sentCount === 0 || summary.completedCount >= summary.sentCount;
      if ((hasNarrative || hasInterview) && allInstrumentsBack) return "complete";
      if (hasNarrative || hasInterview || (summary && summary.sentCount > 0)) return "partial";
      return "empty";
    }

    case "directAssessment": {
      // Stage 2: also reflects the ABC assessment range being set and
      // fully tagged (via the denormalized abcAnalysisSummary) plus the
      // ABC interpretation narrative, on top of the original Stage 1
      // pair of observation narratives.
      const hasObservations = Boolean(content.onSiteObservations?.trim());
      const hasCommunity = Boolean(content.communityParticipation?.trim());
      const hasAnyNarrative = hasObservations || hasCommunity;
      const rangeSet = Boolean(content.abcRangeStart && content.abcRangeEnd);
      const summary = content.abcAnalysisSummary;
      const fullyTagged = !summary || summary.totalLogsInRange === 0 || summary.taggedCount >= summary.totalLogsInRange;
      const hasInterpretation = Boolean(content.abcInterpretation?.trim());

      if (hasObservations && hasCommunity && rangeSet && fullyTagged && hasInterpretation) return "complete";
      if (hasAnyNarrative || rangeSet) return "partial";
      return "empty";
    }

    case "afls": {
      if (!afls) return "empty";
      const scored = Object.values(afls.scoresData ?? {}).reduce((n, items) => n + items.length, 0);
      if (scored === 0) return "empty";
      return scored >= TOTAL_AFLS_ITEMS ? "complete" : "partial";
    }

    case "recommendations": {
      const total =
        (content.recommendationsHome?.length ?? 0) +
        (content.recommendationsSchool?.length ?? 0) +
        (content.recommendationsShared?.length ?? 0);
      return total > 0 ? "complete" : "empty";
    }

    case "conclusion":
      return content.conclusion?.trim() ? "complete" : "empty";

    case "review":
      // Read-only overview of the other 13 -- no completeness state of
      // its own to show.
      return "empty";

    default:
      return "empty";
  }
}
