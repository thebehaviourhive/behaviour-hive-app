"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Clinical director's dashboard, Step 0 recon -- set_clinic_hours()
// (migration 0255) had a working RPC and no UI anywhere until this.
// Mirrors SetStartTimeSheet's own shape exactly: one BottomSheet, one
// RPC call, the same save/cancel button pair.

interface SetClinicHoursSheetProps {
  isOpen: boolean;
  institutionId: string;
  currentStartTime: string; // "HH:MM:SS"
  currentEndTime: string;
  onClose: () => void;
  onSaved: (newStartTime: string, newEndTime: string) => void;
}

export function SetClinicHoursSheet({
  isOpen,
  institutionId,
  currentStartTime,
  currentEndTime,
  onClose,
  onSaved,
}: SetClinicHoursSheetProps) {
  const [startValue, setStartValue] = useState(currentStartTime.slice(0, 5));
  const [endValue, setEndValue] = useState(currentEndTime.slice(0, 5));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function close() {
    if (isSubmitting) return;
    setSubmitError(null);
    onClose();
  }

  async function handleSave() {
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_clinic_hours", {
      p_institution_id: institutionId,
      p_start_time: `${startValue}:00`,
      p_end_time: `${endValue}:00`,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved(`${startValue}:00`, `${endValue}:00`);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Clinic Hours</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        The clinic&apos;s own ordinary working hours -- parents will only ever be offered a booking slot inside this
        window.
      </p>

      <div className="mt-4 flex gap-3">
        <div className="flex-1">
          <label htmlFor="clinic-hours-start" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
            Opens
          </label>
          <input
            id="clinic-hours-start"
            type="time"
            value={startValue}
            onChange={(e) => setStartValue(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
        </div>
        <div className="flex-1">
          <label htmlFor="clinic-hours-end" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
            Closes
          </label>
          <input
            id="clinic-hours-end"
            type="time"
            value={endValue}
            onChange={(e) => setEndValue(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
        </div>
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
