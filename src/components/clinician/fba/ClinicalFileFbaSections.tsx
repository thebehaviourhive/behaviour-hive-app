import { FBA_SECTIONS } from "@/lib/fba/sections";
import { ClientProfileSection } from "@/components/clinician/fba/sections/ClientProfileSection";
import { NarrativeSectionBody } from "@/components/clinician/fba/sections/NarrativeSectionBody";
import { AssessmentMethodsSection } from "@/components/clinician/fba/sections/AssessmentMethodsSection";
import { TargetBehavioursSection } from "@/components/clinician/fba/sections/TargetBehavioursSection";
import { TriggersSettingEventsSection } from "@/components/clinician/fba/sections/TriggersSettingEventsSection";
import { IndirectAssessmentSection } from "@/components/clinician/fba/sections/IndirectAssessmentSection";
import { DirectAssessmentSection } from "@/components/clinician/fba/sections/DirectAssessmentSection";
import { AflsResultsView } from "@/components/clinician/fba/afls-results/AflsResultsView";
import { RecommendationsSection } from "@/components/clinician/fba/sections/RecommendationsSection";
import { ConclusionSection } from "@/components/clinician/fba/sections/ConclusionSection";
import { ReviewSection } from "@/components/clinician/fba/sections/ReviewSection";
import type { FbaAflsData, FbaReport } from "@/lib/fba/types";

// Every reused section body still expects the editor prop quartet even
// in readOnly mode -- guaranteed never to fire, since every interactive
// path in each component is gated behind `!readOnly`.
function noOpFieldChange() {}
function noOpFieldBlur() {}
function noOpStructuralChange() {}

// "Clinical view" for the Clinical File's FBA tab (Fix 2): the exact
// same section body components the clinician's own per-section
// workspace pages render (/clinician/fba/[fbaId]/section/[sectionId]),
// concatenated into one continuous scroll instead of paged navigation --
// this is an embedded tab, not a standalone workspace. Deliberately a
// SEPARATE component from FbaSectionsReadOnly (the parent-facing
// "Family view" a few lines over in this same tab) rather than a shared
// one with a role flag threaded through every section: the two use
// genuinely different bodies for indirectAssessment (this one shows
// IndirectAssessmentSection, the clinician's own blind-response view;
// Family view shows ReaderIndirectAssessment, the parent-simplified
// one) and pass isClinicianWorkspace to Recommendations/Review where
// Family view doesn't -- forcing both through one component would mean
// a role branch inside nearly every section case, exactly what
// FbaSectionsReadOnly's own header comment already avoids for the
// clinician/parent split it does cover.
//
// readOnly is always true here -- this tab only ever renders a
// COMPLETED FBA (see ClinicalFileFbaTab), so there's no live-editing
// path to wire up. isClinicianWorkspace=true on Recommendations is what
// surfaces Fix 1's Calm Card authoring affordances (create/edit/
// publish/delete) even though the FBA's own content is locked --
// CalmCardSection has no readOnly gate of its own by design.
export function ClinicalFileFbaSections({
  fbaId,
  passportId,
  report,
  afls,
}: {
  fbaId: string;
  passportId: string;
  report: FbaReport;
  afls: FbaAflsData | null;
}) {
  const content = report.contentData;

  return (
    <>
      {FBA_SECTIONS.map((section) => (
        <section key={section.slug} id={`fba-clinical-section-${section.slug}`}>
          <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
            Section {section.number}
          </p>
          <h2 className="mb-3 font-heading text-lg font-bold text-brand-prussian-blue">{section.title}</h2>

          {section.kind === "clientProfile" && (
            <ClientProfileSection
              passportId={passportId}
              content={content}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "narrative" && (
            <NarrativeSectionBody
              section={section}
              content={content}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "assessmentMethods" && (
            <AssessmentMethodsSection
              content={content}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "targetBehaviours" && (
            <TargetBehavioursSection
              content={content}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "triggersSettingEvents" && (
            <TriggersSettingEventsSection
              content={content}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "indirectAssessment" && (
            <IndirectAssessmentSection
              fbaId={fbaId}
              passportId={passportId}
              content={content}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "directAssessment" && (
            <DirectAssessmentSection
              passportId={passportId}
              content={content}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "afls" && (
            <AflsResultsView scoresData={afls?.scoresData ?? {}} summary={afls?.summary ?? null} variant="digital" />
          )}
          {section.kind === "recommendations" && (
            <RecommendationsSection
              fbaId={fbaId}
              isClinicianWorkspace
              content={content}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "conclusion" && (
            <ConclusionSection
              content={content}
              onFieldChange={noOpFieldChange}
              onFieldBlur={noOpFieldBlur}
              onStructuralChange={noOpStructuralChange}
              readOnly
            />
          )}
          {section.kind === "review" && (
            <ReviewSection
              fbaId={fbaId}
              passportId={passportId}
              content={content}
              afls={afls}
              readOnly
              isClinicianWorkspace
            />
          )}
        </section>
      ))}
    </>
  );
}
