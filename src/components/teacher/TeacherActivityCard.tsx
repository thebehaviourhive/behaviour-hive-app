"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import { getChildDisplayName } from "@/lib/childDisplayName";
import type { ActivityEventType } from "@/lib/activityEvents";

interface TeacherActivityEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
  child_name: string;
}

export function TeacherActivityCard() {
  const [entries, setEntries] = useState<TeacherActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_teacher_activity_feed", {
        p_limit: 3,
        p_offset: 0,
      });

      if (!isMounted) return;
      setEntries((data ?? []) as TeacherActivityEntry[]);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, []);

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
              event_description: `${getChildDisplayName(entry.child_name)} — ${entry.event_description}`,
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
