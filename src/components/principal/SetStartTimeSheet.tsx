"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 2, Stage 6 follow-up (migration 0133). Principal-only, per
// institution -- mirrors SetCutoffSheet's own shape exactly. Activation
// used to be a fixed constant not shown as editable anywhere; it's now
// a per-institution setting the same shape as the cut-off, so this is a
// deliberate sibling component, not a generalisation of SetCutoffSheet
// into one sheet with a mode -- the two settings are validated against
// each other server-side (each RPC checks it stays on the correct side
// of the institution's OTHER current value), and keeping them as two
// small, separately-named sheets keeps that relationship legible on the
// School page rather than folded into one component's internal branching.

interface SetStartTimeSheetProps {
  isOpen: boolean;
  institutionId: string;
  currentStartTime: string; // "HH:MM:SS"
  onClose: () => void;
  onSaved: (newStartTime: string) => void;
}

export function SetStartTimeSheet({ isOpen, institutionId, currentStartTime, onClose, onSaved }: SetStartTimeSheetProps) {
  const [value, setValue] = useState(currentStartTime.slice(0, 5));
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
    const { error } = await supabase.rpc("set_temporary_access_start_time", {
      p_institution_id: institutionId,
      p_start_time: `${value}:00`,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved(`${value}:00`);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Temporary Access Start Time</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Temporary cover access (granted SNAs and supply teachers) starts at this time and ends at the school&apos;s
        cut-off, every day, until changed.
      </p>

      <div className="mt-4">
        <label htmlFor="start-time" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          Start time
        </label>
        <input
          id="start-time"
          type="time"
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
