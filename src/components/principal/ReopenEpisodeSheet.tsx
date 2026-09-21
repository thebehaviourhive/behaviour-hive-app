"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";

// Tier 1 item 3 (clinic UI layer), extracted 21 Sept 2026 -- shared by
// ChildDetail's own per-child Enrolment tab and Directory's Children
// list. No reason needed (reopen_clinic_episode() takes none); a single
// confirm, matching this app's own "deliberate act, one clear question"
// shape for anything that starts something new.

interface ReopenEpisodeSheetProps {
  isOpen: boolean;
  institutionId: string;
  passportId: string;
  childName: string;
  onClose: () => void;
  onReopened: () => void;
}

export function ReopenEpisodeSheet({
  isOpen,
  institutionId,
  passportId,
  childName,
  onClose,
  onReopened,
}: ReopenEpisodeSheetProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (isSubmitting) return;
    setError(null);
    onClose();
  }

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("reopen_clinic_episode", {
      p_institution_id: institutionId,
      p_passport_id: passportId,
    });

    setIsSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setError(null);
    onReopened();
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Reopen {childName}?</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Starts a new episode of care for this client at your clinic. Their previous episode stays on record exactly
        as it ended -- caseload assignment is a fresh, deliberate decision, not carried over automatically.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {error}
        </p>
      )}

      <Button type="button" onClick={handleConfirm} disabled={isSubmitting} className="mt-5">
        {isSubmitting ? "Reopening…" : "Reopen"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
