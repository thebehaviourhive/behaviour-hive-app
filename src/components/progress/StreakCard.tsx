import type { StreakSummary } from "@/lib/progress/regulation";

// Parent lens only (constraint A2). Warm, celebratory copy -- no
// numbers-as-alerts framing here, streaks are inherently a positive
// metric so there's no tone-rule tension to manage the way the
// distribution comparison has.
export function StreakCard({ streaks }: { streaks: StreakSummary }) {
  const { currentSettledStreak, bestSettledStreak, currentCheckinStreak, bestCheckinStreak } = streaks;

  if (bestCheckinStreak === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-brand-golden-brown/20 bg-brand-safe-ivory/30 p-4">
        <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
          Settled streak
        </p>
        <p className="mt-1 font-heading text-2xl font-bold text-brand-prussian-blue">
          {currentSettledStreak} <span className="text-sm font-semibold text-brand-neutral-black/50">day{currentSettledStreak === 1 ? "" : "s"}</span>
        </p>
        <p className="mt-0.5 text-xs text-brand-neutral-black/60">
          {currentSettledStreak > 0 && currentSettledStreak === bestSettledStreak
            ? "Your best yet! 🎉"
            : `Best: ${bestSettledStreak} day${bestSettledStreak === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white p-4">
        <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
          Check-in streak
        </p>
        <p className="mt-1 font-heading text-2xl font-bold text-brand-prussian-blue">
          {currentCheckinStreak} <span className="text-sm font-semibold text-brand-neutral-black/50">day{currentCheckinStreak === 1 ? "" : "s"}</span>
        </p>
        <p className="mt-0.5 text-xs text-brand-neutral-black/60">
          {currentCheckinStreak > 0 && currentCheckinStreak === bestCheckinStreak
            ? "Your best yet! 🎉"
            : `Best: ${bestCheckinStreak} day${bestCheckinStreak === 1 ? "" : "s"}`}
        </p>
      </div>
    </div>
  );
}
