"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";

// Outstanding-task snoozing, 25 Sept 2026. The one sheet every
// snoozable row in the product opens -- reason required (the audit
// trail is non-negotiable, per the brief), days pre-filled with the
// institution's own configured default but editable per snooze.
// Calls snooze_outstanding_task() directly; the caller (SnoozableWorkQueueRow)
// re-fetches snooze status afterward via onSnoozed, rather than this
// sheet guessing at the new state itself.
export function SnoozeSheet({
  isOpen,
  onClose,
  institutionId,
  queueKey,
  itemId,
  itemLabel,
  defaultDays,
  onSnoozed,
}: {
  isOpen: boolean;
  onClose: () => void;
  institutionId: string;
  queueKey: string;
  itemId: string;
  itemLabel: string;
  defaultDays: number;
  onSnoozed: () => void;
}) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(String(defaultDays));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (isSubmitting) return;
    setReason("");
    setDays(String(defaultDays));
    setError(null);
    onClose();
  }

  async function handleSnooze() {
    const parsedDays = Number.parseInt(days, 10);
    if (!Number.isFinite(parsedDays) || parsedDays <= 0 || parsedDays > 90) {
      setError("Enter a number of days between 1 and 90.");
      return;
    }
    if (!reason.trim()) {
      setError("A short reason is required.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("snooze_outstanding_task", {
      p_institution_id: institutionId,
      p_queue_key: queueKey,
      p_item_id: itemId,
      p_reason: reason.trim(),
      p_days: parsedDays,
    });
    setIsSubmitting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setReason("");
    onSnoozed();
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Snooze</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        &quot;{itemLabel}&quot; will leave everyone&apos;s queue at this institution for the time below, then come
        back on its own, exactly as it left it. Nothing is deleted — this is recorded and stays on the record even
        after it returns.
      </p>

      <label htmlFor="snooze-days" className="mt-4 mb-1.5 block text-sm font-semibold text-brand-neutral-black">
        Days
      </label>
      <input
        id="snooze-days"
        type="number"
        min={1}
        max={90}
        value={days}
        onChange={(e) => setDays(e.target.value)}
        className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
      />

      <label htmlFor="snooze-reason" className="mt-4 mb-1.5 block text-sm font-semibold text-brand-neutral-black">
        Reason
      </label>
      <textarea
        id="snooze-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. FBA is in progress, due back from the clinician in 6 weeks"
        className="w-full resize-none rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
      />

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {error}
        </p>
      )}

      <Button type="button" onClick={handleSnooze} disabled={isSubmitting} className="mt-4">
        {isSubmitting ? "Snoozing…" : "Snooze"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={close}
        disabled={isSubmitting}
        className="mt-2 !border-black/10 !text-black/60"
      >
        Cancel
      </Button>
    </BottomSheet>
  );
}
