"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";

// The centre_manager dashboard build, 25 Sept 2026 -- reopen_clinic_
// episode()'s own respite branch (0297), same shape as EndPlacementSheet's
// own sibling: a dedicated component with placement-appropriate copy,
// not a widening of ReopenEpisodeSheet (whose own text says "clinic").
// No reason needed -- reopen_clinic_episode() takes none, matching this
// app's own "deliberate act, one clear question" shape for anything
// that starts something new.
export function ReopenPlacementSheet({
  isOpen,
  institutionId,
  passportId,
  childName,
  onClose,
  onReopened,
}: {
  isOpen: boolean;
  institutionId: string;
  passportId: string;
  childName: string;
  onClose: () => void;
  onReopened: () => void;
}) {
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
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        Reopen {childName}&apos;s placement?
      </h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Starts a new placement for this client at your centre. Their previous placement stays on record exactly as
        it ended -- their stay history is not carried over automatically.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {error}
        </p>
      )}

      <Button type="button" onClick={handleConfirm} disabled={isSubmitting} className="mt-5">
        {isSubmitting ? "Reopening…" : "Reopen Placement"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
