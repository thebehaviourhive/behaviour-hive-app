"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 1, Stage 3, Step 3. Principal-only, per institution -- the one
// setting temporary access has. Activation (7:30am) is a fixed
// constant, not shown as editable here at all -- only the cut-off
// varies by school.

interface SetCutoffSheetProps {
  isOpen: boolean;
  institutionId: string;
  currentCutoffTime: string; // "HH:MM:SS"
  onClose: () => void;
  onSaved: (newCutoff: string) => void;
}

export function SetCutoffSheet({ isOpen, institutionId, currentCutoffTime, onClose, onSaved }: SetCutoffSheetProps) {
  const [value, setValue] = useState(currentCutoffTime.slice(0, 5));
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
    const { error } = await supabase.rpc("set_temporary_access_cutoff", {
      p_institution_id: institutionId,
      p_cutoff_time: `${value}:00`,
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
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Temporary Access Cut-off</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Temporary cover access (granted SNAs and supply teachers) starts at 7:30am and ends at this time, every day,
        until changed.
      </p>

      <div className="mt-4">
        <label htmlFor="cutoff-time" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          Cut-off time
        </label>
        <input
          id="cutoff-time"
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
