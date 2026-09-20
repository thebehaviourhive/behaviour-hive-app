"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Clinical director's dashboard, Step 0 recon -- set_booking_window_days()
// (migration 0255). How far ahead a parent can see and book.

interface SetBookingWindowSheetProps {
  isOpen: boolean;
  institutionId: string;
  currentDays: number;
  onClose: () => void;
  onSaved: (newDays: number) => void;
}

export function SetBookingWindowSheet({ isOpen, institutionId, currentDays, onClose, onSaved }: SetBookingWindowSheetProps) {
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
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      setSubmitError("Enter a number of days between 1 and 365.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_booking_window_days", {
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
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Booking Window</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        How many days ahead a parent can see and book an appointment, starting from today.
      </p>

      <div className="mt-4">
        <label htmlFor="booking-window" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          Days
        </label>
        <input
          id="booking-window"
          type="number"
          min={1}
          max={365}
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
