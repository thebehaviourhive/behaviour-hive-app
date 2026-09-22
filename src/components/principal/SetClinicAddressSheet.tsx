"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { TextField } from "@/components/ui/TextField";

// Booking-flow redesign, Sept 2026 -- the confirm/booked screens show
// "the clinic's address for in-person" (design brief, section 5, step
// 4). No location field existed anywhere in this schema until
// migration 0283. Mirrors SetClinicHoursSheet's own shape exactly: one
// BottomSheet, one RPC call, the same save/cancel button pair.

interface SetClinicAddressSheetProps {
  isOpen: boolean;
  institutionId: string;
  currentAddress: string | null;
  onClose: () => void;
  onSaved: (newAddress: string | null) => void;
}

export function SetClinicAddressSheet({ isOpen, institutionId, currentAddress, onClose, onSaved }: SetClinicAddressSheetProps) {
  const [value, setValue] = useState(currentAddress ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function close() {
    if (isSubmitting) return;
    setSubmitError(null);
    setValue(currentAddress ?? "");
    onClose();
  }

  async function handleSave() {
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_clinic_address", { p_institution_id: institutionId, p_address: value });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved(value.trim() || null);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Clinic Address</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Shown to a parent booking an in-person session, so they know where to go.
      </p>

      <div className="mt-4">
        <TextField label="Address" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 12 Merrion Square, Dublin 2" />
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
