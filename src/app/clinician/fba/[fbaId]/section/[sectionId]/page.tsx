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

  // Seeds local editable state from the loaded report/AFLS row -- a
  // genuine sync-from-external-source effect (the fetch itself lives in
  // useFbaReport), not a derivation that belongs in render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (report) setContent(report.contentData);
  }, [report]);

  useEffect(() => {
    if (afls) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAflsScores(afls.scoresData);
      setAflsSummary(afls.summary ?? "");
    }
  }, [afls]);

  function triggerSave(next: FbaContentData) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    saveContent(next, controller);
  }

  function handleFieldChange(next: FbaContentData) {
    setContent(next);
  }

  function handleFieldBlur() {
    triggerSave(content);
  }

  function handleStructuralChange(next: FbaContentData) {
    setContent(next);
    triggerSave(next);
  }

  function triggerAflsSave(scores: AflsScoresData, summaryValue: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    saveAfls(scores, summaryValue.trim() ? summaryValue : null, controller);
  }

  function handleAflsScoreChange(domain: string, itemId: string, score: AflsScoreValue) {
    const existing = aflsScores[domain] ?? [];
    const nextDomainScores = existing.some((s) => s.itemId === itemId)
      ? existing.map((s) => (s.itemId === itemId ? { ...s, score } : s))
      : [...existing, { itemId, score }];
    const next = { ...aflsScores, [domain]: nextDomainScores };
    setAflsScores(next);
    triggerAflsSave(next, aflsSummary);
  }

  function handleAflsSummaryChange(value: string) {
    setAflsSummary(value);
  }

  function handleAflsSummaryBlur() {
    triggerAflsSave(aflsScores, aflsSummary);
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
      saveError={saveError}
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
              content={content}
              onFieldChange={handleFieldChange}
              onFieldBlur={handleFieldBlur}
              onStructuralChange={handleStructuralChange}
              readOnly={readOnly}
            />
          )}
          {section.kind === "directAssessment" && (
            <DirectAssessmentSection
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
          {section.kind === "review" && <ReviewSection content={content} afls={afls} />}
        </>
      )}
    </FbaSectionShell>
  );
}
