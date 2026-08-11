"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useFbaReport } from "@/hooks/useFbaReport";
import { useFaiInstrument } from "@/hooks/useFaiInstrument";
import { FbaSectionShell } from "@/components/clinician/fba/FbaSectionShell";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import { FAI_ITEM_IDS, type FaiInterview, type FbaContentData } from "@/lib/fba/types";

// Items 2-4 (name/age, respondent name, respondent relation) are short
// answers -- a single-line field reads better than a 3-row textarea for
// them. Everything else (5-24) is genuinely long-form. This is a
// presentation judgment call, not something the item bank itself
// encodes (its answer_type only distinguishes "date" from everything
// else that's free text).
const SHORT_ANSWER_IDS: string[] = [FAI_ITEM_IDS.childNameAndAge, FAI_ITEM_IDS.respondentName, FAI_ITEM_IDS.respondentRelation];

function computeAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    today.getMonth() > dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

export default function FaiInterviewPage() {
  const { fbaId, interviewId } = useParams<{ fbaId: string; interviewId: string }>();
  const router = useRouter();
  const { isReady } = useRequireRole("clinician");
  const { report, isLoading, loadError, saveContent, saveStatus, saveError } = useFbaReport(fbaId);
  const { items, loadError: itemsError } = useFaiInstrument();

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const changeVersionRef = useRef(0);
  const versionAtSaveStartRef = useRef(0);
  const [isDirty, setIsDirty] = useState(false);
  const hasSeededRef = useRef(false);
  const hasPrefilledChildRef = useRef(false);

  const readOnly = report?.status === "completed";

  // Seeds local answers from this specific interview exactly once per
  // mount -- same reasoning as the main section editor page: saveContent
  // hands back a new report object on every successful save, and
  // reseeding on that echo would stomp a fresher unsaved keystroke made
  // while a previous save was still in flight.
  useEffect(() => {
    if (!report || hasSeededRef.current) return;
    const interview = (report.contentData.faiInterviews ?? []).find((iv) => iv.id === interviewId);
    if (!interview) return;
    hasSeededRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnswers(interview.answers);
  }, [report, interviewId]);

  // Pre-fills item 2 (child's name and age) from the real passport, but
  // only once and only if this interview has never had that field
  // touched -- a freshly-created interview's answers only ever contain
  // item 1 (today's date, set at creation) at this point.
  useEffect(() => {
    if (!hasSeededRef.current || hasPrefilledChildRef.current) return;
    if (!report || FAI_ITEM_IDS.childNameAndAge in answers) {
      hasPrefilledChildRef.current = true;
      return;
    }
    hasPrefilledChildRef.current = true;
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("passports")
      .select("child_name, date_of_birth")
      .eq("id", report.passportId)
      .maybeSingle()
      .then(({ data }) => {
        if (!isMounted || !data?.child_name) return;
        const prefill = data.date_of_birth
          ? `${data.child_name}, age ${computeAge(data.date_of_birth)}`
          : data.child_name;
        changeVersionRef.current += 1;
        setIsDirty(true);
        setAnswers((prev) => ({ ...prev, [FAI_ITEM_IDS.childNameAndAge]: prefill }));
      });
    return () => {
      isMounted = false;
    };
    // `answers` is a real dependency here, not an oversight: on the
    // render where `report` first loads, the seed effect above hasn't
    // committed its setAnswers yet, so this effect would otherwise see
    // stale (pre-seed) `answers` and could resolve the prefill check
    // against the wrong snapshot. Re-running once `answers` actually
    // updates is what lets hasPrefilledChildRef's guard fire against the
    // real seeded value instead.
  }, [report, answers]);

  useEffect(() => {
    if (saveStatus === "saved" && versionAtSaveStartRef.current === changeVersionRef.current) {
      setIsDirty(false);
    }
  }, [saveStatus]);

  function markChanged() {
    changeVersionRef.current += 1;
    setIsDirty(true);
  }

  function buildContentWith(nextAnswers: Record<string, string>): FbaContentData {
    const existing = report?.contentData ?? {};
    const interviews = existing.faiInterviews ?? [];
    const nextInterview: FaiInterview = { id: interviewId, answers: nextAnswers };
    const found = interviews.some((iv) => iv.id === interviewId);
    const nextInterviews = found
      ? interviews.map((iv) => (iv.id === interviewId ? nextInterview : iv))
      : [...interviews, nextInterview];
    return { ...existing, faiInterviews: nextInterviews };
  }

  function triggerSave(nextAnswers: Record<string, string>) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    versionAtSaveStartRef.current = changeVersionRef.current;
    saveContent(buildContentWith(nextAnswers), controller);
  }

  function handleAnswerChange(itemId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
    markChanged();
  }

  function handleBlur() {
    triggerSave(answers);
  }

  function handleFlushSave() {
    triggerSave(answers);
  }

  function handleCancelSave() {
    abortRef.current?.abort();
  }

  function handleBack() {
    router.push(`/clinician/fba/${fbaId}/section/7`);
  }

  if (!isReady) {
    return null;
  }

  const respondentName = answers[FAI_ITEM_IDS.respondentName]?.trim();

  return (
    <FbaSectionShell
      title={respondentName || "Open-Ended Interview"}
      sectionNumber={7}
      onBack={handleBack}
      saveStatus={saveStatus}
      isDirty={isDirty}
      hasLoaded={!!report && !!items}
      saveError={saveError}
      onFlushSave={handleFlushSave}
      onCancelSave={handleCancelSave}
      readOnly={readOnly}
    >
      {isLoading || !items ? (
        <div className="flex flex-col gap-3">
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : loadError || itemsError ? (
        <InlineErrorState message={loadError ?? itemsError ?? "Something went wrong."} onRetry={() => window.location.reload()} />
      ) : !report ? (
        <InlineErrorState message="This FBA couldn't be found." onRetry={() => window.location.reload()} />
      ) : !(report.contentData.faiInterviews ?? []).some((iv) => iv.id === interviewId) ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-brand-neutral-black/70">This interview doesn&apos;t exist.</p>
          <Link
            href={`/clinician/fba/${fbaId}/section/7`}
            className="text-sm font-semibold text-brand-prussian-blue underline underline-offset-2"
          >
            Back to Indirect Assessment
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((item) => {
            const value = answers[item.id] ?? "";
            // Locked FBAs render as plain read text, matching every
            // other section's readOnly treatment (NarrativeField etc.)
            // rather than greyed-out disabled inputs.
            if (readOnly) {
              return (
                <div key={item.id}>
                  <p className="mb-1.5 text-sm font-semibold text-brand-neutral-black">{item.text}</p>
                  <div className="whitespace-pre-wrap rounded-2xl border border-black/5 bg-white p-4 text-base text-brand-neutral-black">
                    {value.trim() ? value : <span className="text-black/30">Not recorded.</span>}
                  </div>
                </div>
              );
            }
            if (item.answer_type === "date") {
              return (
                <TextField
                  key={item.id}
                  label={item.text}
                  type="date"
                  value={value}
                  onChange={(e) => handleAnswerChange(item.id, e.target.value)}
                  onBlur={handleBlur}
                />
              );
            }
            if (SHORT_ANSWER_IDS.includes(item.id)) {
              return (
                <TextField
                  key={item.id}
                  label={item.text}
                  value={value}
                  onChange={(e) => handleAnswerChange(item.id, e.target.value)}
                  onBlur={handleBlur}
                />
              );
            }
            return (
              <Textarea
                key={item.id}
                label={item.text}
                value={value}
                onChange={(e) => handleAnswerChange(item.id, e.target.value)}
                onBlur={handleBlur}
                rows={4}
              />
            );
          })}
        </div>
      )}
    </FbaSectionShell>
  );
}
