"use client";

import Link from "next/link";
import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import type { ActivityEventType } from "@/lib/activityEvents";

interface PrincipalActivityEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
}

// Migration 0158, Support Button item 6's dashboard preview. Same
// "3 rows, link to the full page" shape as TeacherActivityCard/
// ClinicianActivityCard. Renders inside <main>'s own px-4 (moved above
// the incident list -- see the dashboard's own comment at its call
// site), so this owns no horizontal margin of its own, matching
// ClinicianActivityCard's identical convention for the same reason.
export function PrincipalActivityCard() {
  const fetchPage = useCallback(async (limit: number, offset: number) => {
    const supabase = createClient();
    return supabase.rpc("get_principal_activity_feed", { p_limit: limit, p_offset: offset });
  }, []);

  const { entries, isLoading, loadError, load } = useActivityFeed<PrincipalActivityEntry>({
    fetchPage,
    pageSize: 3,
  });

  return (
    <Link
      href="/principal/activity"
      className="mb-6 block rounded-2xl border border-brand-off-white bg-white p-5 shadow-sm"
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
      ) : loadError ? (
        <InlineErrorState
          message={loadError}
          onRetry={(event) => {
            event.preventDefault();
            event.stopPropagation();
            load();
          }}
        />
      ) : entries.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-brand-pastel-blue bg-brand-off-white/30 p-4 text-center">
          <p className="font-sans text-sm text-brand-neutral-black/70">
            Institutional activity -- like Support Button alerts -- will appear here.
          </p>
        </div>
      ) : (
        entries.map((entry) => (
          <ActivityRow
            key={entry.id}
            entry={{
              id: entry.id,
              event_type: entry.event_type,
              event_description: entry.event_description,
              created_at: entry.created_at,
            }}
          />
        ))
      )}

      <span className="mt-2 block w-full border-t border-brand-off-white pt-2 text-center font-sans text-sm font-bold text-brand-prussian-blue">
        View all activity
      </span>
    </Link>
  );
}
