"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import type { ActivityLogEntry } from "@/lib/activityEvents";

const PAGE_SIZE = 20;

function groupByDate(entries: ActivityLogEntry[]) {
  const groups: { header: string; entries: ActivityLogEntry[] }[] = [];

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

export default function ActivityPage() {
  const { user, isReady } = useRequireRole("parent");
  const {
    passportId,
    isLoading: isLoadingPassport,
    error: passportLoadFailed,
  } = useMyPassport(user?.id);
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!passportId) {
      setIsLoadingActivity(false);
      return;
    }
    setIsLoadingActivity(true);
    setLoadError(null);

    const supabase = createClient();
    const { data, error: activityError } = await supabase
      .from("activity_log")
      .select("id, event_type, event_description, created_at")
      .eq("passport_id", passportId)
      .order("created_at", { ascending: false })
      .range(0, PAGE_SIZE - 1);

    if (activityError) {
      console.error("Failed to load activity log:", activityError);
      setLoadError("Couldn't load your activity.");
      setIsLoadingActivity(false);
      return;
    }

    const rows = (data ?? []) as ActivityLogEntry[];
    setEntries(rows);
    setHasMore(rows.length === PAGE_SIZE);
    setIsLoadingActivity(false);
  }, [passportId]);

  // Fetches once the passport is resolved, and whenever `load`'s
  // identity changes -- a genuine effect for syncing with the external
  // data source, not a synchronous state derivation.
  useEffect(() => {
    if (isLoadingPassport) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, isLoadingPassport]);

  const isLoading = isLoadingPassport || isLoadingActivity;
  const effectiveLoadError = passportLoadFailed ? "Couldn't load your activity." : loadError;

  async function loadMore() {
    if (!passportId || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("activity_log")
      .select("id, event_type, event_description, created_at")
      .eq("passport_id", passportId)
      .order("created_at", { ascending: false })
      .range(entries.length, entries.length + PAGE_SIZE - 1);

    if (error) {
      console.error("Failed to load more activity:", error);
      setLoadMoreError("Couldn't load more activity.");
      setIsLoadingMore(false);
      return;
    }

    const rows = (data ?? []) as ActivityLogEntry[];
    setEntries((prev) => [...prev, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    setIsLoadingMore(false);
  }

  if (!isReady) {
    return null;
  }

  const groups = groupByDate(entries);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-safe-ivory">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/parent-dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">
          Activity
        </h1>
      </header>

      <main className="flex-1 px-4 pb-10">
        {isLoading ? (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
            <ActivityRowSkeleton />
          </div>
        ) : effectiveLoadError ? (
          <InlineErrorState message={effectiveLoadError} onRetry={load} />
        ) : entries.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="font-sans text-sm text-brand-neutral-black/70">
              Activity will appear here once you and your team start using
              the app!
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
                    <ActivityRow key={entry.id} entry={entry} />
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
