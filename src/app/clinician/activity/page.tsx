"use client";

import Link from "next/link";
import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { useClinicianReviewState } from "@/hooks/useClinicianReviewState";
import { ClinicianAccessGate } from "@/components/clinician/ClinicianAccessGate";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import type { ActivityEventType } from "@/lib/activityEvents";

const PAGE_SIZE = 20;

interface ClinicianActivityEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
  child_name: string;
  passport_id: string;
  // Migration 0152 -- non-null only on event_type "incident".
  incident_id: string | null;
}

export default function ClinicianActivityPage() {
  const { user, isReady } = useRequireRole("clinician");
  const { isLoading: isLoadingReview, profile, reviewState, error: reviewError, refresh: refreshReview } =
    useClinicianReviewState(user?.id ?? null);

  const fetchPage = useCallback(async (limit: number, offset: number) => {
    const supabase = createClient();
    return supabase.rpc("get_clinician_activity_feed", { p_limit: limit, p_offset: offset });
  }, []);

  const { groups, isLoading, isLoadingMore, hasMore, loadError, loadMoreError, load, loadMore } =
    useActivityFeed<ClinicianActivityEntry>({ fetchPage, pageSize: PAGE_SIZE, enabled: isReady });

  if (!isReady) {
    return null;
  }

  return (
    <ClinicianAccessGate
      isLoading={isLoadingReview}
      profile={profile}
      reviewState={reviewState}
      error={reviewError}
      onRetry={refreshReview}
    >
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/clinician/dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">
          Activity
        </h1>
      </header>

      <main className="flex-1 px-4 pb-10 lg:max-w-[66.6667%]">
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
              Activity across your connected cases will appear here.
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
                        event_description: `${entry.child_name}: ${entry.event_description}`,
                        created_at: entry.created_at,
                      }}
                      // No standalone incident detail route on this
                      // track -- the real destination is the Clinical
                      // File's own "Incident Log" tab (key stays
                      // "incidentLog", unchanged by the "Incidents" ->
                      // "ABC Logs" rename on the OTHER tab).
                      href={entry.incident_id ? `/clinician/passport/${entry.passport_id}?tab=incidentLog` : undefined}
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
                className="mt-2 w-full lg:w-auto rounded-2xl border border-brand-prussian-blue/20 bg-white px-6 py-3 font-sans text-sm font-bold text-brand-prussian-blue disabled:opacity-50"
              >
                {isLoadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </main>
    </div>
    </ClinicianAccessGate>
  );
}
