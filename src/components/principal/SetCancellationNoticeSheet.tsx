"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 9, Stage 2 -- set_cancellation_notice_hours() (migration 0258).
// Informational only -- billing is out of scope, so this never blocks
// a cancellation; it only decides what warning a parent sees before
// confirming one within the window.

interface SetCancellationNoticeSheetProps {
  isOpen: boolean;
  institutionId: string;
  currentHours: number;
  onClose: () => void;
  onSaved: (newHours: number) => void;
}

export function SetCancellationNoticeSheet({ isOpen, institutionId, currentHours, onClose, onSaved }: SetCancellationNoticeSheetProps) {
  const [value, setValue] = useState(String(currentHours));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function close() {
    if (isSubmitting) return;
    setSubmitError(null);
    onClose();
  }

  async function handleSave() {
    const hours = Number.parseInt(value, 10);
    if (!Number.isFinite(hours) || hours < 0 || hours > 720) {
      setSubmitError("Enter a number of hours between 0 and 720 (30 days).");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_cancellation_notice_hours", {
      p_institution_id: institutionId,
      p_hours: hours,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved(hours);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Cancellation Notice</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        How much notice a parent should ideally give before cancelling. This is shown as a warning at the moment
        they cancel -- it never blocks the cancellation itself.
      </p>

      <div className="mt-4">
        <label htmlFor="cancellation-notice" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          Hours
        </label>
        <input
          id="cancellation-notice"
          type="number"
          min={0}
          max={720}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleSave} disabled={isSubmitting} className="mt-4">
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
