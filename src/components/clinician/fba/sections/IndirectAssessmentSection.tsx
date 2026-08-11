"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFbaInstrumentRequests } from "@/hooks/useFbaInstrumentRequests";
import { NarrativeField } from "../NarrativeField";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { SendQuestionnaireSheet } from "./indirect/SendQuestionnaireSheet";
import { InstrumentRequestChip } from "./indirect/InstrumentRequestChip";
import { InstrumentResultCard } from "./indirect/InstrumentResultCard";
import { FAI_ITEM_IDS, type FaiInterview } from "@/lib/fba/types";
import type { FbaSectionBodyProps } from "./types";

export function IndirectAssessmentSection({
  fbaId,
  passportId,
  content,
  onFieldChange,
  onFieldBlur,
  onStructuralChange,
  readOnly,
}: FbaSectionBodyProps & { fbaId: string; passportId: string }) {
  const router = useRouter();
  const { requests, candidates, isLoading, loadError, reload, sendRequest, sendReminder } =
    useFbaInstrumentRequests(fbaId, passportId);

  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Denormalizes a summary of the request list into content_data
  // whenever it genuinely changes, so getSectionCompleteness (a pure
  // function with no DB access of its own) can reflect real
  // questionnaire progress -- see the FbaContentData comment on
  // indirectAssessmentSummary for the full rationale. Guarded by a
  // value comparison so viewing this section doesn't trigger a save on
  // every mount, only when something actually changed since last save.
  useEffect(() => {
    if (isLoading) return;
    const fresh = {
      sentCount: requests.length,
      completedCount: requests.filter((r) => r.status === "completed").length,
    };
    const current = content.indirectAssessmentSummary;
    if (current?.sentCount === fresh.sentCount && current?.completedCount === fresh.completedCount) {
      return;
    }
    onStructuralChange({ ...content, indirectAssessmentSummary: fresh });
    // Deliberately reacting to `requests`/`isLoading` only -- `content`
    // is read via closure, not as a dependency, so a save triggered by
    // this effect (which changes `content`'s identity) doesn't re-fire
    // itself in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, isLoading]);

  const completedRequests = requests.filter((r) => r.status === "completed");
  const interviews = content.faiInterviews ?? [];

  function updateInterpretation(requestId: string, value: string) {
    onFieldChange({
      ...content,
      instrumentInterpretations: { ...content.instrumentInterpretations, [requestId]: value },
    });
  }

  // Creates the interview shell (just today's date -- the respondent
  // identity and child name/age pre-fill happen on the full-screen
  // form's own first load, not here) and saves it immediately via
  // onStructuralChange, matching every other repeatable-entry section's
  // add pattern, before navigating to it.
  function handleAddInterview() {
    const newInterview: FaiInterview = {
      id: crypto.randomUUID(),
      answers: { [FAI_ITEM_IDS.date]: new Date().toISOString().slice(0, 10) },
    };
    onStructuralChange({ ...content, faiInterviews: [...interviews, newInterview] });
    router.push(`/clinician/fba/${fbaId}/section/7/interview/${newInterview.id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <NarrativeField
        label="Open-Ended Interview Notes"
        value={content.openEndedInterviewNotes ?? ""}
        onChange={(next) => onFieldChange({ ...content, openEndedInterviewNotes: next })}
        onBlur={onFieldBlur}
        readOnly={readOnly}
        rows={10}
      />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-heading text-base font-bold text-brand-neutral-black">
            Open-Ended Functional Assessment Interview
          </p>
          {!readOnly && (
            <button
              type="button"
              onClick={handleAddInterview}
              className="text-sm font-semibold text-brand-prussian-blue"
            >
              + Add Interview
            </button>
          )}
        </div>

        {interviews.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">
              {readOnly ? "No interviews were recorded for this assessment." : "Record one interview per respondent."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {interviews.map((interview) => {
              const respondentName = interview.answers[FAI_ITEM_IDS.respondentName]?.trim();
              const respondentRelation = interview.answers[FAI_ITEM_IDS.respondentRelation]?.trim();
              return (
                <button
                  key={interview.id}
                  type="button"
                  onClick={() => router.push(`/clinician/fba/${fbaId}/section/7/interview/${interview.id}`)}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-brand-neutral-black">
                      {respondentName || "Untitled respondent"}
                    </span>
                    <span className="block text-xs text-brand-neutral-black/50">
                      {respondentRelation || (readOnly ? "No relation recorded" : "Tap to complete")}
                    </span>
                  </span>
                  <span aria-hidden className="flex-shrink-0 text-black/30">
                    ›
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-heading text-base font-bold text-brand-neutral-black">
            QABF &amp; MAS Questionnaires
          </p>
          {!readOnly && (
            <button
              type="button"
              onClick={() => setIsSheetOpen(true)}
              className="text-sm font-semibold text-brand-prussian-blue"
            >
              + Send Questionnaire
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-20 animate-pulse rounded-2xl bg-brand-off-white" />
            <div className="h-20 animate-pulse rounded-2xl bg-brand-off-white" />
          </div>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={reload} />
        ) : requests.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">
              {readOnly
                ? "No questionnaires were sent for this assessment."
                : "Results will appear when questionnaires are completed."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {requests.map((request) => (
              <InstrumentRequestChip
                key={request.id}
                request={request}
                onSendReminder={() => sendReminder(request.id)}
                readOnly={readOnly}
              />
            ))}
          </div>
        )}
      </div>

      {completedRequests.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="font-heading text-base font-bold text-brand-neutral-black">Results</p>
          {completedRequests.map((request) => (
            <InstrumentResultCard
              key={request.id}
              request={request}
              interpretation={content.instrumentInterpretations?.[request.id] ?? ""}
              onInterpretationChange={(value) => updateInterpretation(request.id, value)}
              onInterpretationBlur={onFieldBlur}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}

      <SendQuestionnaireSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        candidates={candidates}
        isLoadingCandidates={isLoading}
        candidatesError={loadError}
        onRetryCandidates={reload}
        requests={requests}
        onSend={sendRequest}
      />
    </div>
  );
}
