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
      ) : entries.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-brand-pastel-blue bg-brand-off-white/30 p-4 text-center">
          <p className="font-sans text-sm text-brand-neutral-black/70">
            Activity will appear here once you and your team start using the
            app!
          </p>
        </div>
      ) : (
        entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
      )}

      <span className="mt-2 block w-full border-t border-brand-off-white/50 pt-2 text-center font-sans text-sm font-bold text-brand-prussian-blue">
        View all activity
      </span>
    </Link>
  );
}
