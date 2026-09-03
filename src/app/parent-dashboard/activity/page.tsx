"use client";

import Link from "next/link";
import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import type { ActivityLogEntry } from "@/lib/activityEvents";

const PAGE_SIZE = 20;

export default function ActivityPage() {
  const { user, isReady } = useRequireRole("parent");
  const {
    passportId,
    isLoading: isLoadingPassport,
    error: passportLoadFailed,
  } = useMyPassport(user?.id);

  // Migration 0152 -- get_parent_activity_feed() UNIONs activity_log
  // with incidents (occurred_at ordering, same gate get_parent_
  // incidents() already uses), real LIMIT/OFFSET over the combined set
  // so pagination stays correct across both sources.
  const fetchPage = useCallback(
    async (limit: number, offset: number) => {
      if (!passportId) return { data: [], error: null };
      const supabase = createClient();
      return supabase.rpc("get_parent_activity_feed", {
        p_passport_id: passportId,
        p_limit: limit,
        p_offset: offset,
      });
    },
    [passportId]
  );

  const {
    groups,
    isLoading: isLoadingActivity,
    isLoadingMore,
    hasMore,
    loadError,
    loadMoreError,
    load,
    loadMore,
  } = useActivityFeed<ActivityLogEntry>({
    fetchPage,
    pageSize: PAGE_SIZE,
    enabled: !isLoadingPassport && Boolean(passportId),
  });

  const isLoading = isLoadingPassport || isLoadingActivity;
  const effectiveLoadError = passportLoadFailed ? "Couldn't load your activity." : loadError;

  if (!isReady) {
    return null;
  }

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
        ) : groups.length === 0 ? (
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
                    <ActivityRow
                      key={entry.id}
                      entry={entry}
                      href={entry.incident_id ? `/parent-dashboard/incidents/${entry.incident_id}` : undefined}
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
