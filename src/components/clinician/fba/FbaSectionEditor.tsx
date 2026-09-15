"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useFbaReport } from "@/hooks/useFbaReport";
import { FBA_SECTIONS, getFbaSection } from "@/lib/fba/sections";
import { FbaSectionShell } from "@/components/clinician/fba/FbaSectionShell";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ClientProfileSection } from "@/components/clinician/fba/sections/ClientProfileSection";
import { NarrativeSectionBody } from "@/components/clinician/fba/sections/NarrativeSectionBody";
import { AssessmentMethodsSection } from "@/components/clinician/fba/sections/AssessmentMethodsSection";
import { TargetBehavioursSection } from "@/components/clinician/fba/sections/TargetBehavioursSection";
import { TriggersSettingEventsSection } from "@/components/clinician/fba/sections/TriggersSettingEventsSection";
import { IndirectAssessmentSection } from "@/components/clinician/fba/sections/IndirectAssessmentSection";
import { DirectAssessmentSection } from "@/components/clinician/fba/sections/DirectAssessmentSection";
import { AflsSection, type AflsSectionHandle } from "@/components/clinician/fba/sections/AflsSection";
import { RecommendationsSection } from "@/components/clinician/fba/sections/RecommendationsSection";
import { ConclusionSection } from "@/components/clinician/fba/sections/ConclusionSection";
import { ReviewSection } from "@/components/clinician/fba/sections/ReviewSection";
import type { FbaContentData } from "@/lib/fba/types";

// FBA section rail, 15 Sept 2026 -- extracted from
// fba/[fbaId]/section/[sectionId]/page.tsx (formerly the whole routed
// page), same move as ClinicalFileDetail's own extraction from the
// clinician desktop pass, Stage 2: this component owns the fetch, all
// fourteen sections' content, and the flush-before-navigate machinery;
// the routed page becomes a thin shell, and the SAME component is
// reused a second time inside the workspace index's own right pane at
// lg+ (fba/[fbaId]/page.tsx).
//
// NAVIGATION IS INJECTED, NOT HARD-CODED, which is the one real
// difference from ClinicalFileDetail's own shape: Previous/Next/Back
// need to mean "router.push a new URL" on the standalone routed page
// (below lg, or visited directly) but "switch the rail's own selection,
// stay on this one URL" at lg+ inside the workspace index -- otherwise
// clicking Next from inside the split view would navigate AWAY from
// the split view entirely, defeating the whole point of building it.
// Neither caller shape needs this component to know anything about
// which one it's in -- onNavigateBack/onNavigateSection are plain
// callbacks either way.
export interface FbaSectionEditorHandle {
  // Same shape as AflsSectionHandle, one level up: resolves once
  // whatever's pending has settled, true only if it actually saved.
  // The workspace index's own rail calls this before switching
  // sections, exactly the same "stay put unless truly saved" rule
  // Previous/Next/Back already apply internally.
  flushPendingSave: () => Promise<boolean>;
}

export const FbaSectionEditor = forwardRef<
  FbaSectionEditorHandle,
  {
    fbaId: string;
    sectionId: string;
    onNavigateBack: () => void;
    onNavigateSection: (slug: string) => void;
  }
>(function FbaSectionEditor({ fbaId, sectionId, onNavigateBack, onNavigateSection }, ref) {
  const { isReady } = useRequireRole("clinician");
  const { report, isLoading, loadError, reload, saveContent, saveStatus, saveError } = useFbaReport(fbaId);

  const section = getFbaSection(sectionId);

  const [content, setContent] = useState<FbaContentData>({});
  const abortRef = useRef<AbortController | null>(null);
  // AFLS save resilience -- lets flushPendingSave wait for AFLS's own
  // (entirely separate) save queue before navigating away from section
  // 11, same as it already waits for the generic content_data path on
  // every other section.
  const aflsRef = useRef<AflsSectionHandle>(null);

  // Single source of truth for the save icon's unsaved/saved split,
  // independent of (but reconciled against) the hook's own saveStatus.
  // changeVersionRef bumps on every keystroke/selection/structural
  // edit/AFLS tap; a save "counts" as catching up to the latest change
  // only if no newer edit landed while it was in flight -- otherwise a
  // stale save resolving successfully would wrongly flip the icon green
  // while a fresher, still-unsaved edit sits on screen.
  const changeVersionRef = useRef(0);
  const versionAtSaveStartRef = useRef(0);
  const [isDirty, setIsDirty] = useState(false);

  // FBA next-section workflow fix: true while Back/Previous/Next (or
  // the rail, via flushPendingSave) is flushing a pending save before
  // navigating -- disables Back/Previous/Next so a second click can't
  // race the first's own outcome.
  const [isNavigating, setIsNavigating] = useState(false);

  // Seeds local editable state from the loaded report exactly ONCE per
  // mount, not on every `report` change -- saveContent creates a NEW
  // report object on every successful save (that's how the hook
  // reflects the write back), which would otherwise re-fire this effect
  // and stomp local state with the (now slightly stale) content that
  // was actually sent, discarding any edit made in the gap between
  // kicking the save off and it resolving.
  //
  // Deliberately no `key={sectionId}` at either call site (the routed
  // page or the workspace index's rail): `content` is the WHOLE FBA's
  // content_data blob, not a per-section slice -- section 1's own
  // fields and section 2's own fields already coexist in the same
  // object, so switching which section is being VIEWED never needs a
  // re-seed, remount, or reset of anything here. useFbaReport(fbaId)'s
  // own fetch is keyed on fbaId alone, which doesn't change when the
  // rail switches sections either, so no wasted re-fetch of the whole
  // report on every click. isDirty/changeVersionRef are similarly
  // whole-FBA, not per-section, and are already guaranteed false/caught
  // up by the time a section switch actually happens -- flushAndAdvance
  // refuses to call onNavigateSection at all otherwise. Same pattern
  // ChildDetail.tsx already established for principal's own split view:
  // no key, an identity-prop change is handled by what the fetch effect
  // itself does, not by forcing a remount.
  const hasSeededReportRef = useRef(false);
  useEffect(() => {
    if (report && !hasSeededReportRef.current) {
      hasSeededReportRef.current = true;
      setContent(report.contentData);
    }
  }, [report]);

  // A save only gets to clear isDirty if nothing changed while it was in
  // flight -- otherwise a slow save resolving after a newer keystroke
  // would wrongly flip the icon green over a fresher unsaved edit.
  useEffect(() => {
    if (saveStatus === "saved" && versionAtSaveStartRef.current === changeVersionRef.current) {
      setIsDirty(false);
    }
  }, [saveStatus]);

  function markChanged() {
    changeVersionRef.current += 1;
    setIsDirty(true);
  }

  function triggerSave(next: FbaContentData) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    versionAtSaveStartRef.current = changeVersionRef.current;
    return saveContent(next, controller);
  }

  function handleFieldChange(next: FbaContentData) {
    setContent(next);
    markChanged();
  }

  function handleFieldBlur() {
    triggerSave(content);
  }

  function handleStructuralChange(next: FbaContentData) {
    setContent(next);
    markChanged();
    triggerSave(next);
  }

  // AFLS assessments each auto-save themselves independently (one tap
  // per chip, no shared "content" blob to flush) -- see AflsSection's
  // own save wiring. The generic flush only ever applies to the other
  // 13 sections' content_data path.
  function handleFlushSave() {
    if (section?.kind !== "afls") {
      triggerSave(content);
    }
  }

  // FBA next-section workflow fix, generalised for the rail: the actual
  // flush logic, returning whether it's safe to move on -- used both by
  // the imperative handle (external callers, i.e. the rail) and
  // internally by Back/Previous/Next. AFLS (section.kind === "afls") has
  // no shared `content` blob at this level -- waits on AflsSection's own
  // queue via aflsRef instead, keeping the coupling to one boolean
  // method rather than reaching into its private save vocabulary.
  //
  // Loops rather than flushing once (generic path only): a newer edit
  // can land while an earlier flush's network round trip is still in
  // flight (the same abort-on-supersede risk triggerSave already
  // handles reactively for blur/structural saves) -- here it needs to
  // be handled proactively, since navigating away must mean nothing is
  // left unsaved. Uses ONLY changeVersionRef/versionAtSaveStartRef
  // (refs, always current), never re-reading `isDirty` state after an
  // await -- a stale closure there would silently under- or over-flush.
  async function flushPendingSaveInternal(): Promise<boolean> {
    if (section?.kind === "afls") {
      setIsNavigating(true);
      const safe = (await aflsRef.current?.flushPendingSave()) ?? true;
      setIsNavigating(false);
      return safe;
    }
    if (!isDirty) return true;
    setIsNavigating(true);
    for (;;) {
      const versionAtThisFlush = changeVersionRef.current;
      const outcome = await triggerSave(content);
      if (outcome !== "saved") {
        // Cancelled or errored -- stay put. Navigating anyway would be
        // the exact bug this exists to prevent, just moved one step
        // later. The header's own SavedStateIndicator already shows it
        // and already offers retry/cancel.
        setIsNavigating(false);
        return false;
      }
      if (changeVersionRef.current === versionAtThisFlush) break; // caught up
      // else: a newer edit landed mid-flush -- loop, flush again with
      // the now-current `content`.
    }
    setIsNavigating(false);
    return true;
  }

  useImperativeHandle(ref, () => ({ flushPendingSave: flushPendingSaveInternal }));

  async function flushAndAdvance(after: () => void) {
    const safe = await flushPendingSaveInternal();
    if (!safe) return;
    after();
  }

  function handleBack() {
    flushAndAdvance(onNavigateBack);
  }

  const sectionIndex = section ? FBA_SECTIONS.findIndex((s) => s.slug === section.slug) : -1;
  const previousSection = sectionIndex > 0 ? FBA_SECTIONS[sectionIndex - 1] : undefined;
  // Section 14 (Review & Status) has its own Finalize action instead of
  // a Next -- no section after it to advance to anyway.
  const nextSection =
    sectionIndex >= 0 && sectionIndex < FBA_SECTIONS.length - 1 ? FBA_SECTIONS[sectionIndex + 1] : undefined;

  function handlePrevious() {
    if (!previousSection) return;
    flushAndAdvance(() => onNavigateSection(previousSection.slug));
  }

  function handleNext() {
    if (!nextSection) return;
    flushAndAdvance(() => onNavigateSection(nextSection.slug));
  }

  function handleCancelSave() {
    abortRef.current?.abort();
  }

  if (!isReady) {
    return null;
  }

  if (!section) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-brand-off-white/40 px-6 text-center">
        <p className="text-sm text-brand-neutral-black/70">This section doesn&apos;t exist.</p>
        <button
          type="button"
          onClick={onNavigateBack}
          className="text-sm font-semibold text-brand-prussian-blue underline underline-offset-2"
        >
          Back to sections
        </button>
      </div>
    );
  }

  // AFLS stays editable even after the FBA is completed -- companion
  // layer, same posture as Calm Cards (migration 0060/0053): the paper
  // assessment may be conducted and transcribed after the FBA locks.
  const readOnly = report?.status === "completed" && section.kind !== "afls";

  return (
    <FbaSectionShell
      title={section.title}
      sectionNumber={section.number}
      onBack={handleBack}
      saveStatus={saveStatus}
      isDirty={isDirty}
      // AFLS manages its own per-assessment save indicator inline
      // (see AflsSection) rather than the shared header one -- passing
      // hasLoaded=false here is what keeps SavedStateIndicator from
      // rendering anything for this section kind.
      hasLoaded={!!report && section.kind !== "afls"}
      saveError={saveError}
      onFlushSave={handleFlushSave}
      onCancelSave={handleCancelSave}
      readOnly={readOnly}
      onPrevious={previousSection ? handlePrevious : undefined}
      onNext={nextSection ? handleNext : undefined}
      isNavigating={isNavigating}
    >
      {isLoading ? (
        <div className="flex flex-col gap-3">
          <div className="h-24 animate-pulse rounded-2xl bg-white" />
          <div className="h-24 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : loadError ? (
        <InlineErrorState message={loadError} onRetry={reload} />
      ) : !report ? (
        <InlineErrorState message="This FBA couldn't be found." onRetry={reload} />
      ) : (
        <>
          {section.kind === "clientProfile" && (
            <ClientProfileSection
              passportId={report.passportId}
              content={content}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onStructuralChange={handleStructuralChange}
              readOnly={readOnly}
            />
          )}
          {section.kind === "narrative" && (
            <NarrativeSectionBody
              section={section}
              content={content}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onStructuralChange={handleStructuralChange}
              readOnly={readOnly}
            />
          )}
          {section.kind === "assessmentMethods" && (
            <AssessmentMethodsSection
              content={content}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onStructuralChange={handleStructuralChange}
              readOnly={readOnly}
            />
          )}
          {section.kind === "targetBehaviours" && (
            <TargetBehavioursSection
              content={content}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onStructuralChange={handleStructuralChange}
              readOnly={readOnly}
            />
          )}
          {section.kind === "triggersSettingEvents" && (
            <TriggersSettingEventsSection
              content={content}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onStructuralChange={handleStructuralChange}
              readOnly={readOnly}
            />
          )}
          {section.kind === "indirectAssessment" && (
            <IndirectAssessmentSection
              fbaId={fbaId}
              passportId={report.passportId}
              content={content}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onStructuralChange={handleStructuralChange}
              readOnly={readOnly}
            />
          )}
          {section.kind === "directAssessment" && (
            <DirectAssessmentSection
              passportId={report.passportId}
              content={content}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onStructuralChange={handleStructuralChange}
              readOnly={readOnly}
            />
          )}
          {section.kind === "afls" && <AflsSection ref={aflsRef} fbaId={fbaId} />}
          {section.kind === "recommendations" && (
            <RecommendationsSection
              fbaId={fbaId}
              passportId={report.passportId}
              isClinicianWorkspace
              content={content}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onStructuralChange={handleStructuralChange}
              readOnly={readOnly}
            />
          )}
          {section.kind === "conclusion" && (
            <ConclusionSection
              content={content}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onStructuralChange={handleStructuralChange}
              readOnly={readOnly}
            />
          )}
          {section.kind === "review" && (
            <ReviewSection
              fbaId={fbaId}
              passportId={report.passportId}
              content={content}
              readOnly={readOnly}
              isClinicianWorkspace
              onFinalized={() => {
                reload();
                onNavigateBack();
              }}
            />
          )}
        </>
      )}
    </FbaSectionShell>
  );
});
