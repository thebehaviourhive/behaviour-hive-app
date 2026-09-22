"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { INSTRUMENT_LABELS, type FbaInstrumentRequest } from "@/lib/fba/types";
import { RoleLabel } from "@/components/ui/RoleLabel";
import type { InstitutionType } from "@/lib/institutionType";
import type { VocabularyOverrides } from "@/lib/vocabulary";

const STATUS_LABEL: Record<FbaInstrumentRequest["status"], string> = {
  sent: "🟡 Sent",
  in_progress: "🟡 In progress",
  completed: "🟢 Completed",
  // Set by finalize_fba_report() (migration 0199) automatically, or by
  // the clinician themselves via cancel_fba_instrument_request() (0292)
  // -- both land on the same status, this chip doesn't distinguish
  // which caused it.
  cancelled: "⚪ Cancelled",
};

const STATUS_PILL_CLASSES: Record<FbaInstrumentRequest["status"], string> = {
  sent: "bg-brand-golden-brown/15 text-brand-golden-brown",
  in_progress: "bg-brand-golden-brown/15 text-brand-golden-brown",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-black/5 text-brand-neutral-black/50",
};

export function InstrumentRequestChip({
  request,
  onSendReminder,
  readOnly,
  institutionType,
  overrides,
}: {
  request: FbaInstrumentRequest;
  onSendReminder: () => Promise<string | null>;
  readOnly: boolean;
  institutionType: InstitutionType;
  overrides: VocabularyOverrides;
}) {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 22 Sept 2026 -- "Cancel request", Daniel's own follow-up ask: a
  // clinician could send a reminder but never withdraw a request they
  // sent by mistake, or no longer need. Self-contained deliberately --
  // calls the RPC directly rather than being wired through
  // useFbaInstrumentRequests.ts's own sendRequest/sendReminder, which
  // would need a new callback threaded down from
  // IndirectAssessmentSection.tsx (a real FBA section file). Tracks its
  // own "just cancelled" state locally so the chip reflects the
  // cancellation immediately without needing the parent's own
  // `requests` list to refetch -- the parent's list catches up to the
  // real status next time it reloads (a reminder sent, a new request,
  // or simply revisiting the section).
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancelledLocally, setIsCancelledLocally] = useState(false);

  const effectiveStatus = isCancelledLocally ? "cancelled" : request.status;

  async function handleReminder() {
    setError(null);
    setIsSending(true);
    const result = await onSendReminder();
    setIsSending(false);
    if (result) setError(result);
  }

  async function handleCancel() {
    setCancelError(null);
    setIsCancelling(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("cancel_fba_instrument_request", { p_request_id: request.id });
    setIsCancelling(false);
    if (rpcError) {
      setCancelError(rpcError.message);
      return;
    }
    setIsConfirmingCancel(false);
    setIsCancelledLocally(true);
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-brand-neutral-black">
            {INSTRUMENT_LABELS[request.instrumentType]}
          </p>
          <p className="text-sm text-brand-neutral-black/60">
            {request.recipientName} ·{" "}
            <RoleLabel role={request.recipientRole} institutionType={institutionType} overrides={overrides} />
          </p>
        </div>
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_PILL_CLASSES[effectiveStatus]}`}
        >
          {STATUS_LABEL[effectiveStatus]}
        </span>
      </div>

      {effectiveStatus !== "completed" && effectiveStatus !== "cancelled" && !readOnly && (
        <div className="mt-3 border-t border-black/5 pt-3">
          {isConfirmingCancel ? (
            <div className="rounded-xl bg-brand-safe-ivory/40 p-3">
              <p className="text-xs text-brand-neutral-black/80">
                Cancel this request? {request.recipientName} will no longer be able to complete it.
              </p>
              {cancelError && <p className="mt-1 text-xs font-medium text-red-600">{cancelError}</p>}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  className="rounded-full bg-brand-golden-brown px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {isCancelling ? "Cancelling…" : "Yes, cancel"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingCancel(false)}
                  disabled={isCancelling}
                  className="rounded-full border border-black/10 px-4 py-1.5 text-xs font-semibold text-black/60"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleReminder}
                disabled={isSending}
                className="text-sm font-semibold text-brand-prussian-blue disabled:opacity-50"
              >
                {isSending ? "Sending…" : "Send reminder"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCancelError(null);
                  setIsConfirmingCancel(true);
                }}
                className="text-sm font-semibold text-brand-neutral-black/50"
              >
                Cancel request
              </button>
              {request.lastRemindedAt && (
                <span className="text-xs text-brand-neutral-black/40">
                  Reminded {formatDistanceToNow(new Date(request.lastRemindedAt), { addSuffix: true })}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
