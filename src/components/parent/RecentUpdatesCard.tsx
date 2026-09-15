"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ActivityRow, ActivityRowSkeleton } from "./ActivityRow";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import type { ActivityLogEntry } from "@/lib/activityEvents";

export function RecentUpdatesCard({ passportId }: { passportId: string | null }) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // No passportId means there's nothing to fetch — derived directly
  // rather than requiring the effect below to set state just to cover
  // that branch.
  const isLoading = isFetching && passportId !== null;

  const load = useCallback(async () => {
    if (!passportId) return;
    setError(null);
    // Migration 0152 -- same interleaved feed the full activity page
    // reads, so this preview matches what "View all activity" leads
    // to. Rows are NOT individually linked here (unlike the full page)
    // -- this whole card is already one outer Link, and nesting a
    // second <a> per incident row inside it is invalid HTML.
    const supabase = createClient();
    const { data, error: fetchError } = await supabase.rpc("get_parent_activity_feed", {
      p_passport_id: passportId,
      p_limit: 3,
      p_offset: 0,
    });

    if (fetchError) {
      console.error("Failed to load recent activity:", fetchError);
      setError("Couldn't load recent activity.");
      setIsFetching(false);
      return;
    }

    setEntries((data ?? []) as ActivityLogEntry[]);
    setIsFetching(false);
  }, [passportId]);

  // Fetches on mount and whenever `load`'s identity changes -- a genuine
  // effect for syncing with the external data source, not a synchronous
  // state derivation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Stage 2, 15 Sept 2026: every other card on this dashboard already
  // returns null when it has nothing to show (PassportCompletionPromptCard,
  // CalmLogReminderCard, the questionnaire prompt); this was the one
  // exception, rendering a full card-sized "nothing has happened yet"
  // apology unconditionally -- including on a brand-new claimed parent's
  // very first visit, when by definition nothing has happened. Loading
  // and error states still render (a skeleton avoids layout jump once
  // real content arrives; an error needs its own retry) -- only the
  // genuinely settled, empty state hides now.
  if (!isLoading && !error && entries.length === 0) {
    return null;
  }

  return (
    <Link
      href="/parent-dashboard/activity"
      className="mb-6 block rounded-2xl border border-brand-off-white/50 bg-white p-5 shadow-sm"
    >
      <h2 className="mb-4 font-heading text-xl font-bold text-brand-prussian-blue">
        Recent Activity
      </h2>

      {isLoading ? (
        <>
          <ActivityRowSkeleton />
          <ActivityRowSkeleton />
          <ActivityRowSkeleton />
        </>
      ) : error ? (
        <InlineErrorState
          message={error}
          onRetry={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsFetching(true);
            load();
          }}
        />
      ) : (
        // entries.length === 0 is unreachable here -- the early return
        // above already handles it.
        entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
      )}

      <span className="mt-2 block w-full border-t border-brand-off-white/50 pt-2 text-center font-sans text-sm font-bold text-brand-prussian-blue">
        View all activity
      </span>
    </Link>
  );
}
