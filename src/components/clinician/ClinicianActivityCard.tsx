"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import type { ActivityEventType } from "@/lib/activityEvents";

interface ClinicianActivityEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
  child_name: string;
}

export function ClinicianActivityCard() {
  const [entries, setEntries] = useState<ClinicianActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const supabase = createClient();
    const { data, error: fetchError } = await supabase.rpc("get_clinician_activity_feed", {
      p_limit: 3,
      p_offset: 0,
    });

    if (fetchError) {
      console.error("Failed to load clinician activity feed:", fetchError);
      setError("Couldn't load recent activity.");
      setIsLoading(false);
      return;
    }

    setEntries((data ?? []) as ClinicianActivityEntry[]);
    setIsLoading(false);
  }, []);

  // Fetches on mount and whenever `load`'s identity changes -- a genuine
  // effect for syncing with the external data source, not a synchronous
  // state derivation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <Link
      href="/clinician/activity"
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
            setIsLoading(true);
            load();
          }}
        />
      ) : entries.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-brand-pastel-blue bg-brand-off-white/30 p-4 text-center">
          <p className="font-sans text-sm text-brand-neutral-black/70">
            Activity across your connected cases will appear here.
          </p>
        </div>
      ) : (
        entries.map((entry) => (
          <ActivityRow
            key={entry.id}
            entry={{
              id: entry.id,
              event_type: entry.event_type,
              event_description: `${entry.child_name}: ${entry.event_description}`,
              created_at: entry.created_at,
            }}
          />
        ))
      )}

      <span className="mt-2 block w-full border-t border-brand-off-white/50 pt-2 text-center font-sans text-sm font-bold text-brand-prussian-blue">
        View all activity
      </span>
    </Link>
  );
}
