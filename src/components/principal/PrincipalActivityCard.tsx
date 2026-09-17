"use client";

import Link from "next/link";
import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import type { ActivityEventType } from "@/lib/activityEvents";
import type { VocabularyOverrides } from "@/lib/vocabulary";
import type { InstitutionType } from "@/lib/institutionType";
import { formatActivityDescription } from "@/lib/principalActivityFeed";

interface PrincipalActivityEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
  // Migration 0192 -- null on staff-level/support_alert rows
  // (institution-wide, not per-child).
  child_name: string | null;
  // PRD 5 Stage 1, migration 0202 -- non-null only on the "staff
  // joined" row. event_description no longer bakes in a role label
  // (that was a tenth, SQL-side copy of the same map every other
  // surface had); this raw value is formatted below via the shared
  // vocabulary function instead.
  actor_role: string | null;
}

// Migration 0158, Support Button item 6's dashboard preview. Same
// "3 rows, link to the full page" shape as TeacherActivityCard/
// ClinicianActivityCard. Renders inside <main>'s own px-4 (moved above
// the incident list -- see the dashboard's own comment at its call
// site), so this owns no horizontal margin of its own, matching
// ClinicianActivityCard's identical convention for the same reason.
export function PrincipalActivityCard({
  institutionType,
  overrides,
}: {
  institutionType: InstitutionType;
  overrides: VocabularyOverrides;
}) {
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
            Activity across your school -- incidents, ABC logs, and Support Button alerts -- will appear here.
          </p>
        </div>
      ) : (
        entries.map((entry) => (
          <ActivityRow
            key={entry.id}
            entry={{
              id: entry.id,
              event_type: entry.event_type,
              // Migration 0192 -- support_alert/staff-level rows are
              // institution-wide, not per-child (child_name null); only
              // prefix rows that actually have one.
              event_description: formatActivityDescription(entry, institutionType, overrides),
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
