"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import type { StrategyFeedbackRating } from "@/lib/strategyFeedback";

// Stage 2's Calm episode rating (Closing the Loop). Non-safety-path
// only -- CalmFlow never mounts this on the escalation path, same
// absolute rule CalmLogNudgeSheet already follows (see that
// component's own header comment). Shown BEFORE the existing log
// nudge on a normal exit, per the brief -- one rating ask per episode,
// for the LAST-VIEWED card only (v1 simplification, deliberately not
// asking about every card seen -- see CalmFlow's own comment on why).
//
// One tap records and the sheet closes immediately -- no confirmation
// screen, matching the brief's "the moment moves on" instruction.
// Skip is always available and is NOT a fourth rating option -- it
// records nothing at all, distinct from the other three which are all
// real signal.
export function CalmRatingSheet({
  isOpen,
  cardTitle,
  onRate,
  onSkip,
}: {
  isOpen: boolean;
  cardTitle: string;
  onRate: (rating: StrategyFeedbackRating) => void;
  onSkip: () => void;
}) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onSkip}>
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
          Did &ldquo;{cardTitle}&rdquo; help?
        </h2>
        <div className="flex w-full flex-col gap-2.5">
          <button
            type="button"
            onClick={() => onRate("helped")}
            className="w-full rounded-2xl bg-calm-ink py-4 text-base font-semibold text-white"
          >
            Helped
          </button>
          <button
            type="button"
            onClick={() => onRate("partly")}
            className="w-full rounded-2xl border-2 border-calm-ink py-4 text-base font-semibold text-calm-ink"
          >
            A little
          </button>
          <button
            type="button"
            onClick={() => onRate("not")}
            className="w-full rounded-2xl border-2 border-black/10 py-4 text-base font-semibold text-brand-neutral-black/70"
          >
            Not this time
          </button>
        </div>
        <button type="button" onClick={onSkip} className="text-sm font-semibold text-black/40">
          Skip
        </button>
      </div>
    </BottomSheet>
  );
}
