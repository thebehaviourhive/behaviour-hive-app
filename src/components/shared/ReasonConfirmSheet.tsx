"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Generic reason-required confirm sheet -- the same shape as
// DeactivateStaffSheet's own reason step, pulled out shared rather than
// re-typed at each of the several places Stage 2 needs it (removing a
// teacher from a class, removing a child from a class, ending an SNA
// assignment). Every one of those RPCs requires a non-empty reason and
// is append-only on the server side (ended_at/ended_by/end_reason, never
// a delete) -- this sheet is just the one picker over all of them.

interface ReasonConfirmSheetProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  submittingLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<{ error: string | null }>;
  onConfirmed: () => void;
}

export function ReasonConfirmSheet({
  isOpen,
  title,
  description,
  confirmLabel,
  submittingLabel,
  onClose,
  onConfirm,
  onConfirmed,
}: ReasonConfirmSheetProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setReason("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleConfirm() {
    if (!reason.trim()) {
      setSubmitError("A reason is required.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const { error } = await onConfirm(reason.trim());
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error);
      return;
    }
    reset();
    onConfirmed();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">{title}</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">{description}</p>

      <div className="mt-4">
        <Textarea
          label="Reason"
          id="reason-confirm-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Moved to a different class"
        />
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleConfirm} disabled={isSubmitting} className="mt-4 !bg-brand-golden-brown">
        {isSubmitting ? submittingLabel : confirmLabel}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
