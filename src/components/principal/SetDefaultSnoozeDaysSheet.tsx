"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Outstanding-task snoozing, 25 Sept 2026 -- the per-institution N.
// One shared sheet, three call sites (School, Clinic, and the new
// Centre settings page), matching SetBookingBufferSheet's own shape
// exactly -- reused, not forked per institution type, since the
// underlying setting is genuinely the same thing at all three.
export function SetDefaultSnoozeDaysSheet({
  isOpen,
  institutionId,
  currentDays,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  institutionId: string;
  currentDays: number;
  onClose: () => void;
  onSaved: (newDays: number) => void;
}) {
  const [value, setValue] = useState(String(currentDays));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function close() {
    if (isSubmitting) return;
    setSubmitError(null);
    onClose();
  }

  async function handleSave() {
    const days = Number.parseInt(value, 10);
    if (!Number.isFinite(days) || days <= 0 || days > 90) {
      setSubmitError("Enter a number of days between 1 and 90.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_institution_default_snooze_days", {
      p_institution_id: institutionId,
      p_days: days,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved(days);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Default Snooze Length</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        When someone snoozes an outstanding task without picking a different number of days, this is how long it
        stays out of the queue before it comes back.
      </p>

      <div className="mt-4">
        <label htmlFor="default-snooze-days" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          Days
        </label>
        <input
          id="default-snooze-days"
          type="number"
          min={1}
          max={90}
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
