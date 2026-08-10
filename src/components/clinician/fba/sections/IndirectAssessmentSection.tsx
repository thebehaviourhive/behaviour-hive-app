"use client";

import { useEffect, useState } from "react";
import { useFbaInstrumentRequests } from "@/hooks/useFbaInstrumentRequests";
import { NarrativeField } from "../NarrativeField";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { SendQuestionnaireSheet } from "./indirect/SendQuestionnaireSheet";
import { InstrumentRequestChip } from "./indirect/InstrumentRequestChip";
import { InstrumentResultCard } from "./indirect/InstrumentResultCard";
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

  function updateInterpretation(requestId: string, value: string) {
    onFieldChange({
      ...content,
      instrumentInterpretations: { ...content.instrumentInterpretations, [requestId]: value },
    });
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
