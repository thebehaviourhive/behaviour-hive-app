"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";

// PRD 10 Stage 4, section 5.6 -- "changing one should state its effect."
// One shared confirm sheet for all five toggles rather than five copies:
// the caller builds the title/effect sentence (which names the people
// actually affected, or says plainly that no one currently holds the
// role), this component only handles the confirm/cancel/saving/error
// mechanics.

interface ToggleConfirmSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  effectText: string;
  onConfirm: () => Promise<void>;
}

export function ToggleConfirmSheet({ isOpen, onClose, title, effectText, onConfirm }: ToggleConfirmSheetProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (isSaving) return;
    setError(null);
    onClose();
  }

  async function handleConfirm() {
    setIsSaving(true);
    setError(null);
    try {
      await onConfirm();
      setIsSaving(false);
      onClose();
    } catch (e) {
      setIsSaving(false);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">{title}</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">{effectText}</p>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {error}
        </p>
      )}

      <Button type="button" onClick={handleConfirm} disabled={isSaving} className="mt-4">
        {isSaving ? "Saving…" : "Confirm"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={close}
        disabled={isSaving}
        className="mt-2 !border-black/10 !text-black/60"
      >
        Cancel
      </Button>
    </BottomSheet>
  );
}
