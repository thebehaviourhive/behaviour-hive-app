"use client";

import { useEffect, useState } from "react";
import { clearPendingLogReminder, getPendingLogReminder } from "@/lib/calmCards/logReminder";

// The [Not now] path's soft reminder (constraint 3C) -- same localStorage
// dismissible-card pattern the dashboard's own "Passport Completed!"
// card already establishes (read once on mount via an effect, since
// localStorage isn't available during SSR; Dismiss writes it away).
// Clearing on LOGGING (as opposed to this explicit Dismiss) happens
// separately, in passport/dashboard/page.tsx's ABCLogger onComplete --
// this component only ever re-reads the key fresh on its own mount, so
// that clear is picked up next time the parent visits this dashboard,
// same as every other localStorage-driven card in this app.
export function CalmLogReminderCard({ userId }: { userId: string }) {
  const [episodeId, setEpisodeId] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEpisodeId(getPendingLogReminder(userId)?.episodeId ?? null);
  }, [userId]);

  if (!episodeId) return null;

  function dismiss() {
    clearPendingLogReminder(userId);
    setEpisodeId(null);
  }

  return (
    <div className="rounded-2xl border border-calm-pill bg-calm-pill/15 p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-lg">
          🩹
        </span>
        <p className="flex-1 text-sm text-brand-neutral-black">
          Remember to log this morning&apos;s incident when you&apos;re ready.
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="mt-3 w-full rounded-full border border-black/15 py-2 text-xs font-semibold text-black/50"
      >
        Dismiss
      </button>
    </div>
  );
}
