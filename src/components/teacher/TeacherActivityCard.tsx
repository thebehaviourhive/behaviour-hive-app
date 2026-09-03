"use client";

import Link from "next/link";
import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { getChildDisplayName } from "@/lib/childDisplayName";
import type { ActivityEventType } from "@/lib/activityEvents";

interface TeacherActivityEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
  // Migration 0155 -- null on support_alert rows (institution-wide,
  // not per-child).
  child_name: string | null;
}

export function TeacherActivityCard() {
  const fetchPage = useCallback(async (limit: number, offset: number) => {
    const supabase = createClient();
    return supabase.rpc("get_teacher_activity_feed", { p_limit: limit, p_offset: offset });
  }, []);

  const { entries, isLoading, loadError, load } = useActivityFeed<TeacherActivityEntry>({
    fetchPage,
    pageSize: 3,
  });

  return (
    <Link
      href="/teacher/activity"
      className="mx-4 mb-6 block rounded-2xl border border-brand-off-white bg-white p-5 shadow-sm"
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
            Activity across your linked students will appear here.
          </p>
        </div>
      ) : (
        entries.map((entry) => (
          <ActivityRow
            key={entry.id}
            entry={{
              id: entry.id,
              event_type: entry.event_type,
              // Migration 0155 -- support_alert rows are institution-
              // wide, not per-child (child_name null); only prefix
              // rows that actually have one.
              event_description: entry.child_name
                ? `${getChildDisplayName(entry.child_name)} — ${entry.event_description}`
                : entry.event_description,
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
