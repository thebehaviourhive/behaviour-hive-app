"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ActivityRow, ActivityRowSkeleton } from "./ActivityRow";
import type { ActivityLogEntry } from "@/lib/activityEvents";

export function RecentUpdatesCard({ passportId }: { passportId: string | null }) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!passportId) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("activity_log")
        .select("id, event_type, event_description, created_at")
        .eq("passport_id", passportId)
        .order("created_at", { ascending: false })
        .limit(3);

      if (!isMounted) return;
      setEntries((data ?? []) as ActivityLogEntry[]);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  return (
    <Link
      href="/parent-dashboard/activity"
      className="mb-6 block rounded-2xl border border-brand-off-white/50 bg-white p-5 shadow-sm"
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
            Activity will appear here once you and your team start using the
            app!
          </p>
        </div>
      ) : (
        entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
      )}

      <span className="mt-2 block w-full border-t border-brand-off-white/50 pt-2 text-center font-sans text-sm font-bold text-brand-prussian-blue">
        View all activity
      </span>
    </Link>
  );
}
