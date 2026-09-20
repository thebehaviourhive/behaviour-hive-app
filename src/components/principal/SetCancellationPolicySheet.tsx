"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Textarea } from "@/components/ui/Textarea";

// PRD 9, Stage 2 -- set_cancellation_policy_text() (migration 0258).
// The director's own words, in their own clinic's voice -- no default
// text is ever shown as a stand-in for "nobody has written this yet";
// an empty policy is a real, honest state, checked for explicitly by
// the booking flow (see /passport/book/page.tsx).

interface SetCancellationPolicySheetProps {
  isOpen: boolean;
  institutionId: string;
  currentText: string | null;
  onClose: () => void;
  onSaved: (newText: string | null) => void;
}

export function SetCancellationPolicySheet({ isOpen, institutionId, currentText, onClose, onSaved }: SetCancellationPolicySheetProps) {
  const [value, setValue] = useState(currentText ?? "");
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
    const { error } = await supabase.rpc("set_cancellation_policy_text", {
      p_institution_id: institutionId,
      p_text: value,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved(value.trim() || null);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Cancellation Policy</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Shown to a parent at the moment they book, and copied onto their booking as it stands right then -- editing
        this later never changes what an earlier booking was made under.
      </p>

      <div className="mt-4">
        <Textarea
          label="Policy text"
          id="cancellation-policy-text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Please give at least 24 hours' notice if you need to cancel or change a session."
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
