"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { INSTRUMENT_LABELS, type FbaInstrumentRequest } from "@/lib/fba/types";
import { RoleLabel } from "@/components/ui/RoleLabel";
import type { InstitutionType } from "@/lib/institutionType";
import type { VocabularyOverrides } from "@/lib/vocabulary";

const STATUS_LABEL: Record<FbaInstrumentRequest["status"], string> = {
  sent: "🟡 Sent",
  in_progress: "🟡 In progress",
  completed: "🟢 Completed",
  // Set only by finalize_fba_report() (migration 0199) -- the clinician's
  // own outstanding request was withdrawn because they finalised the FBA
  // it belonged to, not because the recipient did anything.
  cancelled: "⚪ Cancelled (FBA finalised)",
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

  // 22 Sept 2026 -- a cancelled request only ever exists because
  // finalize_fba_report() (0199) cancelled it in the same transaction
  // that completed this FBA, so it's dead the moment it's possible: the
  // FBA is already locked, nothing more can happen with it. Rendered as
  // nothing rather than a muted "Cancelled" chip -- the finalised
  // section shouldn't keep showing a request that can never be acted
  // on again. This is a render-only change: the underlying `requests`
  // array (and everything IndirectAssessmentSection.tsx derives from
  // its length -- indirectAssessmentSummary, the empty-state check) is
  // completely untouched, since that file is not touched by this fix.
  if (request.status === "cancelled") {
    return null;
  }

  async function handleReminder() {
    setError(null);
    setIsSending(true);
    const result = await onSendReminder();
    setIsSending(false);
    if (result) setError(result);
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
          className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_PILL_CLASSES[request.status]}`}
        >
          {STATUS_LABEL[request.status]}
        </span>
      </div>

      {/* "cancelled" is excluded by the early return above -- TypeScript
          already knows request.status can't be "cancelled" here. */}
      {request.status !== "completed" && !readOnly && (
        <div className="mt-3 flex items-center gap-3 border-t border-black/5 pt-3">
          <button
            type="button"
            onClick={handleReminder}
            disabled={isSending}
            className="text-sm font-semibold text-brand-prussian-blue disabled:opacity-50"
          >
            {isSending ? "Sending…" : "Send reminder"}
          </button>
          {request.lastRemindedAt && (
            <span className="text-xs text-brand-neutral-black/40">
              Reminded {formatDistanceToNow(new Date(request.lastRemindedAt), { addSuffix: true })}
            </span>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
