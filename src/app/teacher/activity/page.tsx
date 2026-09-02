"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { getChildDisplayName } from "@/lib/childDisplayName";
import type { ActivityEventType } from "@/lib/activityEvents";

const PAGE_SIZE = 20;

interface TeacherActivityEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
  child_name: string;
  // Migration 0152 -- non-null only on event_type "incident".
  incident_id: string | null;
}

function groupByDate(entries: TeacherActivityEntry[]) {
  const groups: { header: string; entries: TeacherActivityEntry[] }[] = [];

  for (const entry of entries) {
    const date = new Date(entry.created_at);
    const header = isToday(date)
      ? "Today"
      : isYesterday(date)
        ? "Yesterday"
        : format(date, "d MMMM");

    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.header === header) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ header, entries: [entry] });
    }
  }

  return groups;
}

export default function TeacherActivityPage() {
  const { isReady } = useRequireRole("class_teacher");
  const [entries, setEntries] = useState<TeacherActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isReady) return;
    setIsLoading(true);
    setLoadError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_teacher_activity_feed", {
      p_limit: PAGE_SIZE,
      p_offset: 0,
    });

    if (error) {
      console.error("Failed to load teacher activity:", error);
      setLoadError("Couldn't load your activity.");
      setIsLoading(false);
      return;
    }

    const rows = (data ?? []) as TeacherActivityEntry[];
    setEntries(rows);
    setHasMore(rows.length === PAGE_SIZE);
    setIsLoading(false);
  }, [isReady]);

  // Fetches on mount and whenever `load`'s identity changes -- a genuine
  // effect for syncing with the external data source, not a synchronous
  // state derivation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function loadMore() {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_teacher_activity_feed", {
      p_limit: PAGE_SIZE,
      p_offset: entries.length,
    });

    if (error) {
      console.error("Failed to load more teacher activity:", error);
      setLoadMoreError("Couldn't load more activity.");
      setIsLoadingMore(false);
      return;
    }

    const rows = (data ?? []) as TeacherActivityEntry[];
    setEntries((prev) => [...prev, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    setIsLoadingMore(false);
  }

  if (!isReady) {
    return null;
  }

  const groups = groupByDate(entries);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/teacher/dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Activity</h1>
      </header>

      <main className="flex-1 px-4 pb-10">
        {isLoading ? (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
          </div>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={load} />
        ) : entries.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="font-sans text-sm text-brand-neutral-black/70">
              Activity across your linked students will appear here.
            </p>
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <section key={group.header} className="mb-5">
                <h2 className="mb-2 font-accent text-xs font-bold uppercase tracking-widest text-brand-neutral-black/50">
                  {group.header}
                </h2>
                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  {group.entries.map((entry) => (
                    <ActivityRow
                      key={entry.id}
                      entry={{
                        id: entry.id,
                        event_type: entry.event_type,
                        event_description: `${getChildDisplayName(entry.child_name)} — ${entry.event_description}`,
                        created_at: entry.created_at,
                      }}
                      href={entry.incident_id ? `/teacher/incidents/${entry.incident_id}` : undefined}
                    />
                  ))}
                </div>
              </section>
            ))}

            {loadMoreError && (
              <InlineErrorState message={loadMoreError} onRetry={loadMore} />
            )}

            {hasMore && !loadMoreError && (
              <button
                type="button"
                onClick={loadMore}
                disabled={isLoadingMore}
                className="mt-2 w-full rounded-2xl border border-brand-prussian-blue/20 bg-white py-3 font-sans text-sm font-bold text-brand-prussian-blue disabled:opacity-50"
              >
                {isLoadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
