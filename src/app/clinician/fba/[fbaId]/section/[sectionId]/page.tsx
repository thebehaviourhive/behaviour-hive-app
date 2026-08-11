"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useFbaReport } from "@/hooks/useFbaReport";
import { getFbaSection } from "@/lib/fba/sections";
import { FbaSectionShell } from "@/components/clinician/fba/FbaSectionShell";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ClientProfileSection } from "@/components/clinician/fba/sections/ClientProfileSection";
import { NarrativeSectionBody } from "@/components/clinician/fba/sections/NarrativeSectionBody";
import { AssessmentMethodsSection } from "@/components/clinician/fba/sections/AssessmentMethodsSection";
import { TargetBehavioursSection } from "@/components/clinician/fba/sections/TargetBehavioursSection";
import { TriggersSettingEventsSection } from "@/components/clinician/fba/sections/TriggersSettingEventsSection";
import { IndirectAssessmentSection } from "@/components/clinician/fba/sections/IndirectAssessmentSection";
import { DirectAssessmentSection } from "@/components/clinician/fba/sections/DirectAssessmentSection";
import { AflsSection } from "@/components/clinician/fba/sections/AflsSection";
import { RecommendationsSection } from "@/components/clinician/fba/sections/RecommendationsSection";
import { ConclusionSection } from "@/components/clinician/fba/sections/ConclusionSection";
import { ReviewSection } from "@/components/clinician/fba/sections/ReviewSection";
import type { AflsScoresData, AflsScoreValue, FbaContentData } from "@/lib/fba/types";

export default function FbaSectionEditorPage() {
  const { fbaId, sectionId } = useParams<{ fbaId: string; sectionId: string }>();
  const router = useRouter();
  const { isReady } = useRequireRole("clinician");
  const { report, afls, isLoading, loadError, reload, saveContent, saveAfls, saveStatus, saveError } =
    useFbaReport(fbaId);

  const section = getFbaSection(sectionId);

  const [content, setContent] = useState<FbaContentData>({});
  const [aflsScores, setAflsScores] = useState<AflsScoresData>({});
  const [aflsSummary, setAflsSummary] = useState("");
  const abortRef = useRef<AbortController | null>(null);

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

  // Seeds local editable state from the loaded report/AFLS row exactly
  // ONCE per mount, not on every `report`/`afls` change -- both
  // saveContent and saveAfls create a NEW report/afls object on every
  // successful save (that's how the hook reflects the write back), which
  // would otherwise re-fire this effect and stomp local state with the
  // (now slightly stale) content that was actually sent, discarding any
  // edit made in the gap between kicking the save off and it resolving.
  // A genuine reload (e.g. after finalizing) doesn't need this to
  // re-seed either -- the section becomes read-only at that point, so
  // local editable state is moot.
  const hasSeededReportRef = useRef(false);
  useEffect(() => {
    if (report && !hasSeededReportRef.current) {
      hasSeededReportRef.current = true;
      setContent(report.contentData);
    }
  }, [report]);

  const hasSeededAflsRef = useRef(false);
  useEffect(() => {
    if (afls && !hasSeededAflsRef.current) {
      hasSeededAflsRef.current = true;
      setAflsScores(afls.scoresData);
      setAflsSummary(afls.summary ?? "");
    }
  }, [afls]);

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
    saveContent(next, controller);
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

  function triggerAflsSave(scores: AflsScoresData, summaryValue: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    versionAtSaveStartRef.current = changeVersionRef.current;
    saveAfls(scores, summaryValue.trim() ? summaryValue : null, controller);
  }

  function handleAflsScoreChange(domain: string, itemId: string, score: AflsScoreValue) {
    const existing = aflsScores[domain] ?? [];
    const nextDomainScores = existing.some((s) => s.itemId === itemId)
      ? existing.map((s) => (s.itemId === itemId ? { ...s, score } : s))
      : [...existing, { itemId, score }];
    const next = { ...aflsScores, [domain]: nextDomainScores };
    setAflsScores(next);
    markChanged();
    triggerAflsSave(next, aflsSummary);
  }

  function handleAflsSummaryChange(value: string) {
    setAflsSummary(value);
    markChanged();
  }

  function handleAflsSummaryBlur() {
    triggerAflsSave(aflsScores, aflsSummary);
  }

  // The save icon's tap target: flushes whatever's pending through the
  // exact same save path a blur/structural edit would use. Local
  // `content`/`aflsScores`/`aflsSummary` already reflect every keystroke
  // (onChange, not onBlur, is what updates them), so this genuinely
  // covers a currently-focused, not-yet-blurred field too -- there's no
  // separate "flush" data path to keep in sync with the real one.
  function handleFlushSave() {
    if (section?.kind === "afls") {
      triggerAflsSave(aflsScores, aflsSummary);
    } else {
      triggerSave(content);
    }
  }

  function handleBack() {
    router.push(`/clinician/fba/${fbaId}`);
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
        <Link
          href={`/clinician/fba/${fbaId}`}
          className="text-sm font-semibold text-brand-prussian-blue underline underline-offset-2"
        >
          Back to sections
        </Link>
      </div>
    );
  }

  const readOnly = report?.status === "completed";

  return (
    <FbaSectionShell
      title={section.title}
      sectionNumber={section.number}
      onBack={handleBack}
      saveStatus={saveStatus}
      isDirty={isDirty}
      hasLoaded={!!report}
      saveError={saveError}
      onFlushSave={handleFlushSave}
      onCancelSave={handleCancelSave}
      readOnly={readOnly}
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
          {section.kind === "afls" && (
            <AflsSection
              scoresData={aflsScores}
              summary={aflsSummary}
              onScoreChange={handleAflsScoreChange}
              onSummaryChange={handleAflsSummaryChange}
              onSummaryBlur={handleAflsSummaryBlur}
              readOnly={readOnly}
            />
          )}
          {section.kind === "recommendations" && (
            <RecommendationsSection
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
              afls={afls}
              readOnly={readOnly}
              onFinalized={() => {
                reload();
                router.push(`/clinician/fba/${fbaId}`);
              }}
            />
          )}
        </>
      )}
    </FbaSectionShell>
  );
}
