"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveInstructionText } from "@/lib/fba/resolveInstruction";
import { getChildDisplayName } from "@/lib/childDisplayName";

export interface MyAssessmentToComplete {
  id: string;
  childName: string;
  instrumentName: string;
  clinicianName: string;
  instruction: string | null;
  assignedAt: string;
  lastRemindedAt: string | null;
}

// The assigned respondent's own completion flow. Mirrors Questionnaire-
// Flow.tsx's own shell (full-screen takeover, body-scroll-lock, tap-an-
// option answer buttons) but renders NUMBERED ROWS against the
// instrument's own response_scale, never item text -- there is none to
// render, per 13a. Every tap saves immediately via submit_assessment_
// response(), matching this app's own dominant auto-save-per-
// interaction idiom (AssessmentResponseSheetEditor's own clinician-
// facing rows, AFLS) rather than QuestionnaireFlow's own manual-submit
// two-button footer -- there is no separate "in progress" vs
// "completed" STATUS for the respondent to set here at all; completion
// is entirely the clinician's own later act (marking completed_at), so
// nothing here needs to distinguish a save from a submit.
//
// Fetches via get_assessment_to_complete() ONLY -- never a raw select
// on assessments. That RPC returns exactly the fields a respondent may
// see (instrument name, item_count, response_scale, instruction, their
// own responses) and nothing else -- no interpretation, no scores, no
// subscale totals, ever.
export function AssessmentResponseFlow({
  assessmentId,
  onClose,
}: {
  assessmentId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{
    childName: string;
    instrumentName: string;
    itemCount: number;
    responseScale: string[];
    clinicianName: string;
    instruction: string | null;
  } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .rpc("get_assessment_to_complete", { p_assessment_id: assessmentId })
      .then(({ data: rows, error }) => {
        if (!isMounted) return;
        if (error) {
          setLoadError("Couldn't load this assessment.");
          setIsLoading(false);
          return;
        }
        const row = (rows ?? [])[0] as
          | {
              child_name: string;
              instrument_name: string;
              item_count: number;
              response_scale: string[];
              clinician_name: string;
              instruction: string | null;
              responses: Record<string, string> | null;
            }
          | undefined;
        if (!row) {
          setNotFound(true);
          setIsLoading(false);
          return;
        }
        setData({
          childName: row.child_name,
          instrumentName: row.instrument_name,
          itemCount: row.item_count ?? 0,
          responseScale: row.response_scale ?? [],
          clinicianName: row.clinician_name,
          instruction: row.instruction,
        });
        setAnswers(row.responses ?? {});
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [assessmentId]);

  // Body scroll lock for the lifetime of this full-screen takeover --
  // same idiom as QuestionnaireFlow/ABCLogger.
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  function setAnswer(rowNumber: number, value: string) {
    const next = { ...answers, [String(rowNumber)]: value };
    setAnswers(next);
    setSaveError(null);
    setIsSaving(true);
    const run = async () => {
      const supabase = createClient();
      const { error } = await supabase.rpc("submit_assessment_response", {
        p_assessment_id: assessmentId,
        p_responses: next,
      });
      setIsSaving(false);
      if (error) setSaveError(error.message);
    };
    saveQueueRef.current = saveQueueRef.current.then(run);
  }

  const rowNumbers = data ? Array.from({ length: data.itemCount }, (_, i) => i + 1) : [];
  const answeredCount = Object.keys(answers).filter((k) => answers[k]?.trim()).length;
  const childLabel = getChildDisplayName(data?.childName ?? "");
  const resolvedInstruction = data ? resolveInstructionText(data.instruction ?? undefined, childLabel) : null;

  if (notFound) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-white px-8 text-center">
        <span aria-hidden className="text-4xl">
          🚫
        </span>
        <p className="font-heading text-lg font-semibold text-brand-prussian-blue">This assessment couldn&apos;t be found</p>
        <p className="max-w-xs text-sm text-brand-neutral-black/70">
          It may already have been completed, or you&apos;re no longer assigned to it. Nothing you entered was lost.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 rounded-2xl border-2 border-brand-prussian-blue px-6 py-2.5 text-sm font-semibold text-brand-prussian-blue"
        >
          Close
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-pastel-blue border-t-brand-prussian-blue" />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="text-sm text-red-600">{loadError}</p>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-prussian-blue">
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-black/5 px-4 pt-6 pb-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-lg font-bold text-brand-prussian-blue">{data.instrumentName}</p>
          <p className="truncate text-xs text-brand-neutral-black/50">About {childLabel}</p>
        </div>
        <p className="flex-shrink-0 text-xs font-semibold text-brand-neutral-black/50">
          {answeredCount} of {rowNumbers.length}
        </p>
      </header>

      <div className="h-1.5 w-full flex-shrink-0 bg-black/10">
        <div
          className="h-full bg-brand-prussian-blue transition-all"
          style={{ width: `${rowNumbers.length > 0 ? (answeredCount / rowNumbers.length) * 100 : 0}%` }}
        />
      </div>

      <main className="flex-1 overflow-y-auto px-4 py-5">
        <div className="flex flex-col gap-6">
          {resolvedInstruction && (
            <div className="rounded-r-xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4">
              <p className="text-sm leading-relaxed text-brand-neutral-black">{resolvedInstruction}</p>
            </div>
          )}

          {/* No item text -- there is none to show. Row number only,
              per 13a's own numbered-rows-and-a-scale pattern. */}
          {rowNumbers.map((n) => (
            <div key={n}>
              <p className="mb-3 text-base font-medium text-brand-neutral-black">Row {n}</p>
              <div className="flex flex-col gap-2">
                {data.responseScale.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setAnswer(n, option)}
                    className={`w-full rounded-2xl border py-3.5 text-base font-semibold transition-colors ${
                      answers[String(n)] === option
                        ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                        : "border-black/10 bg-white text-brand-neutral-black"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      {saveError && (
        <p role="alert" className="px-4 pb-2 text-sm font-medium text-red-600">
          {saveError}
        </p>
      )}

      <div className="flex flex-shrink-0 flex-col gap-1 border-t border-black/5 p-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving ? "Saving…" : "Done for now"}
        </button>
        <p className="text-center text-xs text-brand-neutral-black/50">
          Every tap saves immediately — come back any time to finish the rest.
        </p>
      </div>
    </div>
  );
}
