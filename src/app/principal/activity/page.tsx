"use client";

import Link from "next/link";
import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import type { ActivityEventType } from "@/lib/activityEvents";

const PAGE_SIZE = 20;

// Migration 0158, Support Button item 6. Institutional/operational
// events only -- not whole-school-per-child (that's the teacher's own
// job, and would break the privacy posture the incident work-queue
// buckets already hold), not narrowly self-only (too thin to mean
// anything for a role that isn't a participant in most school events
// the way a parent or teacher is). Support alerts are the first, and
// only, event type this feed carries so far -- see that migration's own
// header for what's deliberately not built yet.
//
// Row shape is leaner than the teacher/clinician/parent feeds
// (id/event_type/event_description/created_at only) -- no passport_id/
// child_name/incident_id, because nothing in this feed is ever
// per-child.
interface PrincipalActivityEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
}

export default function PrincipalActivityPage() {
  const { isReady } = useRequireRole("principal");

  const fetchPage = useCallback(async (limit: number, offset: number) => {
    const supabase = createClient();
    return supabase.rpc("get_principal_activity_feed", { p_limit: limit, p_offset: offset });
  }, []);

  const { groups, isLoading, isLoadingMore, hasMore, loadError, loadMoreError, load, loadMore } =
    useActivityFeed<PrincipalActivityEntry>({ fetchPage, pageSize: PAGE_SIZE, enabled: isReady });

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/dashboard"
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
        ) : groups.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="font-sans text-sm text-brand-neutral-black/70">
              Institutional activity -- like Support Button alerts -- will appear here.
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
                        event_description: entry.event_description,
                        created_at: entry.created_at,
                      }}
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
