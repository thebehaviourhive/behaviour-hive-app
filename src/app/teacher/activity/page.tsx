"use client";

import Link from "next/link";
import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useActivityFeed } from "@/hooks/useActivityFeed";
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
  // Migration 0155 -- null on support_alert rows (institution-wide,
  // not per-child).
  child_name: string | null;
  // Migration 0152 -- non-null only on event_type "incident".
  incident_id: string | null;
}

export default function TeacherActivityPage() {
  const { isReady } = useRequireRole("class_teacher");

  const fetchPage = useCallback(async (limit: number, offset: number) => {
    const supabase = createClient();
    return supabase.rpc("get_teacher_activity_feed", { p_limit: limit, p_offset: offset });
  }, []);

  const { groups, isLoading, isLoadingMore, hasMore, loadError, loadMoreError, load, loadMore } =
    useActivityFeed<TeacherActivityEntry>({ fetchPage, pageSize: PAGE_SIZE, enabled: isReady });

  if (!isReady) {
    return null;
  }

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
        ) : groups.length === 0 ? (
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
                        // Migration 0155 -- support_alert rows are
                        // institution-wide, not per-child (child_name
                        // is null); prefixing them with the child-name
                        // fallback ("This child — …") would be a
                        // nonsense sentence, so only child-scoped rows
                        // get the prefix.
                        event_description: entry.child_name
                          ? `${getChildDisplayName(entry.child_name)} — ${entry.event_description}`
                          : entry.event_description,
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
