"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { INSTRUMENT_LABELS, RECIPIENT_ROLE_LABELS, type FbaInstrumentRequest } from "@/lib/fba/types";

const STATUS_LABEL: Record<FbaInstrumentRequest["status"], string> = {
  sent: "🟡 Sent",
  in_progress: "🟡 In progress",
  completed: "🟢 Completed",
};

const STATUS_PILL_CLASSES: Record<FbaInstrumentRequest["status"], string> = {
  sent: "bg-brand-golden-brown/15 text-brand-golden-brown",
  in_progress: "bg-brand-golden-brown/15 text-brand-golden-brown",
  completed: "bg-green-100 text-green-700",
};

export function InstrumentRequestChip({
  request,
  onSendReminder,
  readOnly,
}: {
  request: FbaInstrumentRequest;
  onSendReminder: () => Promise<string | null>;
  readOnly: boolean;
}) {
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            {request.recipientName} · {RECIPIENT_ROLE_LABELS[request.recipientRole]}
          </p>
        </div>
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_PILL_CLASSES[request.status]}`}
        >
          {STATUS_LABEL[request.status]}
        </span>
      </div>

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
