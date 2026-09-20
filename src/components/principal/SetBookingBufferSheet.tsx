"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Clinical director's dashboard, Step 0 recon -- set_booking_buffer_minutes()
// (migration 0255). Applies to every busy block Freebusy reports,
// uniformly -- see availability.ts's own header for why it can't be
// scoped to "our own sessions" only.

interface SetBookingBufferSheetProps {
  isOpen: boolean;
  institutionId: string;
  currentMinutes: number;
  onClose: () => void;
  onSaved: (newMinutes: number) => void;
}

export function SetBookingBufferSheet({ isOpen, institutionId, currentMinutes, onClose, onSaved }: SetBookingBufferSheetProps) {
  const [value, setValue] = useState(String(currentMinutes));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function close() {
    if (isSubmitting) return;
    setSubmitError(null);
    onClose();
  }

  async function handleSave() {
    const minutes = Number.parseInt(value, 10);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 120) {
      setSubmitError("Enter a number of minutes between 0 and 120.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_booking_buffer_minutes", {
      p_institution_id: institutionId,
      p_minutes: minutes,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved(minutes);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Booking Buffer</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Minutes kept clear before and after every existing appointment on a clinician&apos;s calendar, so parents
        are never offered a slot that runs straight into something else.
      </p>

      <div className="mt-4">
        <label htmlFor="booking-buffer" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          Minutes
        </label>
        <input
          id="booking-buffer"
          type="number"
          min={0}
          max={120}
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
