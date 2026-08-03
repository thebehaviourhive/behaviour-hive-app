"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import type { ActivityEventType } from "@/lib/activityEvents";

interface ClinicianActivityEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
  child_name: string;
}

export function ClinicianActivityCard() {
  const [entries, setEntries] = useState<ClinicianActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_clinician_activity_feed", {
        p_limit: 3,
        p_offset: 0,
      });

      if (!isMounted) return;
      setEntries((data ?? []) as ClinicianActivityEntry[]);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <Link
      href="/clinician/activity"
      className="mb-6 block rounded-2xl border-t-4 border-brand-golden-brown bg-white p-5 shadow-sm"
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
        <div className="rounded-xl border-2 border-dashed border-brand-golden-brown/40 bg-brand-safe-ivory/30 p-4 text-center">
          <p className="font-sans text-sm text-brand-neutral-black/70">
            Activity across your connected cases will appear here.
          </p>
        </div>
      ) : (
        entries.map((entry) => (
          <ActivityRow
            key={entry.id}
            entry={{
              id: entry.id,
              event_type: entry.event_type,
              event_description: `${entry.child_name}: ${entry.event_description}`,
              created_at: entry.created_at,
            }}
          />
        ))
      )}

      <span className="mt-2 block w-full border-t border-brand-off-white/50 pt-2 text-center font-sans text-sm font-bold text-brand-golden-brown">
        View all activity
      </span>
    </Link>
  );
}
