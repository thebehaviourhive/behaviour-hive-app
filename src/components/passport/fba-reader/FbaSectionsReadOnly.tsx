import { FBA_SECTIONS } from "@/lib/fba/sections";
import { ClientProfileSection } from "@/components/clinician/fba/sections/ClientProfileSection";
import { NarrativeSectionBody } from "@/components/clinician/fba/sections/NarrativeSectionBody";
import { AssessmentMethodsSection } from "@/components/clinician/fba/sections/AssessmentMethodsSection";
import { TargetBehavioursSection } from "@/components/clinician/fba/sections/TargetBehavioursSection";
import { TriggersSettingEventsSection } from "@/components/clinician/fba/sections/TriggersSettingEventsSection";
import { DirectAssessmentSection } from "@/components/clinician/fba/sections/DirectAssessmentSection";
import { AflsResultsView } from "@/components/clinician/fba/afls-results/AflsResultsView";
import { RecommendationsSection } from "@/components/clinician/fba/sections/RecommendationsSection";
import { ConclusionSection } from "@/components/clinician/fba/sections/ConclusionSection";
import { ReviewSection } from "@/components/clinician/fba/sections/ReviewSection";
import { ReaderIndirectAssessment } from "./ReaderIndirectAssessment";
import type { FbaAflsData, FbaReport } from "@/lib/fba/types";

// Every reused section body still expects the editor prop quartet even
// in readOnly mode -- guaranteed never to fire, since every interactive
// path in each component is gated behind `!readOnly`.
function noOpFieldChange() {}
function noOpFieldBlur() {}
function noOpStructuralChange() {}

// All 14 FBA sections, read-only, in report order -- the single shared
// rendering used by both the parent reader (Part C) and the print/PDF
// view (Part F), so the two can never drift out of sync with each other
// or with the clinician's own readOnly path (the same section body
// components, just rendered with readOnly=true instead of live save
// wiring).
export function FbaSectionsReadOnly({
  fbaId,
  report,
  afls,
  childName,
  sectionClassName,
  isPrint = false,
}: {
  fbaId: string;
  report: FbaReport;
  afls: FbaAflsData | null;
  // Always the full name -- both callers (parent reader, print) are
  // clinical-adjacent surfaces per the instruction-line brief, never
  // the teacher-shortened form. Nullable only because the caller's own
  // fetch may not have resolved yet.
  childName: string | null;
  sectionClassName?: string;
  // Selects the AFLS results variant (print figure/table vs. the digital
  // stacked-bar/accordion) -- see AflsResultsView for the 375px
  // reasoning behind that split.
  isPrint?: boolean;
}) {
  return (
    <>
      {FBA_SECTIONS.map((section) => (
        <section key={section.slug} id={`fba-section-${section.slug}`} className={sectionClassName}>
          <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
            Section {section.number}
          </p>
          <h2 className="mb-3 font-heading text-lg font-bold text-brand-prussian-blue">{section.title}</h2>

          {section.kind === "clientProfile" && (
            <ClientProfileSection
              passportId={report.passportId}
              content={report.contentData}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "narrative" && (
            <NarrativeSectionBody
              section={section}
              content={report.contentData}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "assessmentMethods" && (
            <AssessmentMethodsSection
              content={report.contentData}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "targetBehaviours" && (
            <TargetBehavioursSection
              content={report.contentData}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "triggersSettingEvents" && (
            <TriggersSettingEventsSection
              content={report.contentData}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "indirectAssessment" && (
            <ReaderIndirectAssessment
              fbaId={fbaId}
              content={report.contentData}
              childName={childName ?? "the child"}
            />
          )}
          {section.kind === "directAssessment" && (
            <DirectAssessmentSection
              passportId={report.passportId}
              content={report.contentData}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "afls" && (
            <AflsResultsView
              scoresData={afls?.scoresData ?? {}}
              summary={afls?.summary ?? null}
              variant={isPrint ? "print" : "digital"}
            />
          )}
          {section.kind === "recommendations" && (
            <RecommendationsSection
              content={report.contentData}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "conclusion" && (
            <ConclusionSection
              content={report.contentData}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "review" && (
            <ReviewSection
              fbaId={fbaId}
              passportId={report.passportId}
              content={report.contentData}
              afls={afls}
              readOnly
            />
          )}
        </section>
      ))}
    </>
  );
}
