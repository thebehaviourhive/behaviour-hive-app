"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import {
  INSTRUMENT_LABELS,
  RECIPIENT_ROLE_LABELS,
  type FbaInstrumentRequest,
  type FbaRecipientCandidate,
  type SendableInstrumentType,
} from "@/lib/fba/types";

const INSTRUMENT_OPTIONS: SendableInstrumentType[] = ["open_ended", "qabf", "mas"];

export function SendQuestionnaireSheet({
  isOpen,
  onClose,
  candidates,
  isLoadingCandidates,
  candidatesError,
  onRetryCandidates,
  requests,
  onSend,
}: {
  isOpen: boolean;
  onClose: () => void;
  candidates: FbaRecipientCandidate[];
  isLoadingCandidates: boolean;
  candidatesError: string | null;
  onRetryCandidates: () => void;
  requests: FbaInstrumentRequest[];
  onSend: (instrumentType: SendableInstrumentType, recipientId: string) => Promise<string | null>;
}) {
  const [instrumentType, setInstrumentType] = useState<SendableInstrumentType | null>(null);
  const [sendingFor, setSendingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setInstrumentType(null);
    setSendingFor(null);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSelectRecipient(recipientId: string) {
    if (!instrumentType) return;
    setError(null);
    setSendingFor(recipientId);
    const result = await onSend(instrumentType, recipientId);
    setSendingFor(null);
    if (result) {
      setError(result);
      return;
    }
    reset();
    onClose();
  }

  function hasActiveRequest(recipientId: string): boolean {
    if (!instrumentType) return false;
    return requests.some(
      (r) => r.instrumentType === instrumentType && r.recipientId === recipientId && r.status !== "completed"
    );
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose}>
      {!instrumentType ? (
        <>
          <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
            Send Questionnaire
          </h2>
          <p className="mb-4 mt-1 text-sm text-brand-neutral-black/60">Select an instrument.</p>
          <div className="flex flex-col gap-2">
            {INSTRUMENT_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setInstrumentType(option)}
                className="w-full rounded-2xl border border-black/5 bg-white p-4 text-left text-base font-semibold text-brand-neutral-black shadow-sm"
              >
                {INSTRUMENT_LABELS[option]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setInstrumentType(null);
              setError(null);
            }}
            className="mb-1 text-sm font-semibold text-brand-prussian-blue"
          >
            ‹ Back
          </button>
          <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
            {INSTRUMENT_LABELS[instrumentType]}
          </h2>
          <p className="mb-4 mt-1 text-sm text-brand-neutral-black/60">
            Select who should complete this.
          </p>

          {isLoadingCandidates ? (
            <div className="flex flex-col gap-2">
              <div className="h-14 animate-pulse rounded-2xl bg-brand-off-white" />
              <div className="h-14 animate-pulse rounded-2xl bg-brand-off-white" />
            </div>
          ) : candidatesError ? (
            <InlineErrorState message={candidatesError} onRetry={onRetryCandidates} />
          ) : candidates.length === 0 ? (
            <p className="text-sm text-brand-neutral-black/60">
              No parent or actively-linked teachers found for this child.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {candidates.map((candidate) => {
                const disabled = hasActiveRequest(candidate.recipientId);
                const isSending = sendingFor === candidate.recipientId;
                return (
                  <button
                    key={candidate.recipientId}
                    type="button"
                    disabled={disabled || sendingFor !== null}
                    onClick={() => handleSelectRecipient(candidate.recipientId)}
                    className="flex w-full items-center justify-between rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>
                      <span className="block text-base font-semibold text-brand-neutral-black">
                        {candidate.fullName}
                      </span>
                      <span className="block text-xs text-brand-neutral-black/50">
                        {RECIPIENT_ROLE_LABELS[candidate.role]}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-xs font-semibold text-brand-neutral-black/50">
                      {isSending ? "Sending…" : disabled ? "Already sent" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}
        </>
      )}
    </BottomSheet>
  );
}
