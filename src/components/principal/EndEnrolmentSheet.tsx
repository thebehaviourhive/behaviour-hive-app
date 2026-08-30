"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";

// PRD 1, Stage 6, Step 2. end_enrolment() (0121) requires a reason from
// a fixed set (graduated/left/transferred) -- a button-group picker, not
// ReasonConfirmSheet's own free-text Textarea, which is the wrong shape
// for an enum the database itself constrains.

const REASONS = [
  { value: "graduated", label: "Graduated" },
  { value: "left", label: "Left the school" },
  { value: "transferred", label: "Transferred to another school" },
] as const;

type EndReason = (typeof REASONS)[number]["value"];

interface EndEnrolmentSheetProps {
  isOpen: boolean;
  enrolmentId: string;
  childName: string;
  onClose: () => void;
  onEnded: () => void;
}

export function EndEnrolmentSheet({ isOpen, enrolmentId, childName, onClose, onEnded }: EndEnrolmentSheetProps) {
  const [reason, setReason] = useState<EndReason | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setReason(null);
    setError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleConfirm() {
    if (!reason) return;
    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: endError } = await supabase.rpc("end_enrolment", {
      p_enrolment_id: enrolmentId,
      p_reason: reason,
    });

    setIsSubmitting(false);

    if (endError) {
      setError(endError.message);
      return;
    }

    reset();
    onEnded();
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        End {childName}&apos;s enrolment
      </h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Ends their current class, SNA assignment, and staff passport access
        at your school. This is a record, not a delete -- {childName}&apos;s
        history stays intact, and your school keeps read access to
        everything already written. Their family&apos;s own access to the
        passport is unaffected.
      </p>

      <div className="mt-5 flex flex-col gap-2">
        {REASONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setReason(option.value)}
            className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-colors ${
              reason === option.value
                ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                : "border-black/10 bg-white text-brand-neutral-black"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {error}
        </p>
      )}

      <Button type="button" onClick={handleConfirm} disabled={!reason || isSubmitting} className="mt-5 !bg-brand-golden-brown">
        {isSubmitting ? "Ending enrolment…" : "End enrolment"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
