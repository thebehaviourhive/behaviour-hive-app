"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { createClient } from "@/lib/supabase/client";
import { resolveInstructionText } from "@/lib/fba/resolveInstruction";
import {
  INSTRUMENT_LABELS,
  RECIPIENT_ROLE_LABELS,
  type FbaInstrumentRequest,
  type FbaRecipientCandidate,
  type SendableInstrumentType,
} from "@/lib/fba/types";

// Open-Ended is deliberately absent -- it's a clinician-transcribed form
// now (see the FAI interview list further up Section 7), never sent to
// a recipient. SendableInstrumentType itself no longer includes it, so
// this list can't drift from that even if someone tries to add it back
// here without also widening the type.
const INSTRUMENT_OPTIONS: SendableInstrumentType[] = ["qabf", "mas"];

export function SendQuestionnaireSheet({
  isOpen,
  onClose,
  candidates,
  isLoadingCandidates,
  candidatesError,
  onRetryCandidates,
  requests,
  onSend,
  // Always the full name -- the instruction editor is a clinical
  // surface, same rule as InstrumentResultCard elsewhere in this
  // section. Nullable only because the caller's own fetch may not have
  // resolved yet; the preview falls back to "the child" in that case.
  childName,
}: {
  isOpen: boolean;
  onClose: () => void;
  candidates: FbaRecipientCandidate[];
  isLoadingCandidates: boolean;
  candidatesError: string | null;
  onRetryCandidates: () => void;
  requests: FbaInstrumentRequest[];
  onSend: (instrumentType: SendableInstrumentType, recipientId: string, instruction: string) => Promise<string | null>;
  childName: string | null;
}) {
  const [instrumentType, setInstrumentType] = useState<SendableInstrumentType | null>(null);
  // Set once a recipient is chosen -- from that point the sheet shows
  // the third step (review/edit the instruction, then confirm) instead
  // of sending immediately, per the brief's "after recipient selection"
  // ordering.
  const [selectedRecipient, setSelectedRecipient] = useState<FbaRecipientCandidate | null>(null);
  const [instruction, setInstruction] = useState("");
  const [isLoadingDefault, setIsLoadingDefault] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setInstrumentType(null);
    setSelectedRecipient(null);
    setInstruction("");
    setIsSending(false);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  // Pre-fills from the instrument's own editable-as-data default
  // (fba_instruments.default_instruction) -- still containing the
  // literal "[child name]" token, exactly as stored; nothing here
  // resolves it to a real name, since this same stored text is what
  // gets read back later by every viewer's own name-display rule.
  async function handleSelectRecipient(candidate: FbaRecipientCandidate) {
    if (!instrumentType) return;
    setError(null);
    setSelectedRecipient(candidate);
    setIsLoadingDefault(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("fba_instruments")
      .select("default_instruction")
      .eq("instrument_type", instrumentType)
      .eq("is_active", true)
      .maybeSingle();
    setInstruction(data?.default_instruction ?? "");
    setIsLoadingDefault(false);
  }

  async function handleConfirmSend() {
    if (!instrumentType || !selectedRecipient) return;
    setError(null);
    setIsSending(true);
    const result = await onSend(instrumentType, selectedRecipient.recipientId, instruction);
    setIsSending(false);
    if (result) {
      setError(result);
      return;
    }
    reset();
    onClose();
  }

  // Shown so the clinician never has to mentally substitute the token
  // themselves -- reuses the exact same resolver every downstream
  // viewer calls, so what's previewed here is provably what a
  // clinical-surface reader will actually see (never a bespoke re-
  // implementation that could drift from the real resolution rule).
  const previewText = resolveInstructionText(instruction, childName ?? "the child");

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
      ) : selectedRecipient ? (
        <>
          <button
            type="button"
            onClick={() => {
              setSelectedRecipient(null);
              setError(null);
            }}
            className="mb-1 text-sm font-semibold text-brand-prussian-blue"
          >
            ‹ Back
          </button>
          <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
            Instructions for {selectedRecipient.fullName}
          </h2>
          <p className="mb-4 mt-1 text-sm text-brand-neutral-black/60">
            Shown to them before they begin. Edit if this send should focus on something specific.
          </p>

          {/* Shipped the token-textarea + live-preview fallback, not a
              true inline non-editable chip: this codebase has no
              contentEditable/rich-text infrastructure to build on (no
              slate/tiptap/draft-js, no existing mention-chip component),
              and a from-scratch atomic-chip-inside-editable-text
              implementation carries real cross-browser risk -- caret
              placement around the atomic node, backspace/delete
              atomicity, IME composition, copy/paste -- particularly on
              iOS Safari, this app's primary target, which has
              well-documented contentEditable selection bugs. That risk
              was disproportionate for what's meant to be a small,
              contained fix. The preview below is driven by the exact
              same resolveInstructionText every downstream viewer calls,
              so it's provably what the respondent will actually see,
              and the caption makes the token impossible to miss. */}
          {isLoadingDefault ? (
            <div className="h-32 animate-pulse rounded-2xl bg-brand-off-white" />
          ) : (
            <>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={5}
                placeholder="Instructions for the respondent…"
                className="w-full resize-none rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
              {instruction.includes("[child name]") && (
                <p className="mt-1.5 text-xs text-brand-neutral-black/50">
                  <span className="font-semibold text-brand-prussian-blue">[child name]</span> will be
                  replaced automatically with the child&apos;s name for each recipient -- don&apos;t type
                  over it.
                </p>
              )}
              {previewText && (
                <div className="mt-3 rounded-2xl bg-brand-pastel-blue/15 px-4 py-3">
                  <p className="mb-0.5 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                    Preview
                  </p>
                  <p className="text-sm text-brand-neutral-black">{previewText}</p>
                </div>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleConfirmSend}
            disabled={isSending || isLoadingDefault}
            className="mt-4 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSending ? "Sending…" : "Send"}
          </button>
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
                return (
                  <button
                    key={candidate.recipientId}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelectRecipient(candidate)}
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
                      {disabled ? "Already sent" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}
