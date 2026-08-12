"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";

// Non-safety-path only (constraint 3C) -- CalmFlow never mounts this on
// the escalation path, since "no logging prompts anywhere on or after
// that path" is an absolute, not something this component enforces
// itself.
export function CalmLogNudgeSheet({
  isOpen,
  onLogIt,
  onNotNow,
}: {
  isOpen: boolean;
  onLogIt: () => void;
  onNotNow: () => void;
}) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onNotNow}>
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
          Would it help to log what happened?
        </h2>
        <p className="text-sm text-brand-neutral-black/60">
          A quick ABC log can help spot patterns over time -- entirely optional.
        </p>
        <button
          type="button"
          onClick={onLogIt}
          className="w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white"
        >
          Log it
        </button>
        <button
          type="button"
          onClick={onNotNow}
          className="w-full rounded-2xl border-2 border-black/10 py-3 text-sm font-semibold text-black/60"
        >
          Not now
        </button>
      </div>
    </BottomSheet>
  );
}
