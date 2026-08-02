"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { ActivityRow, ActivityRowSkeleton } from "@/components/parent/ActivityRow";
import type { ActivityLogEntry } from "@/lib/activityEvents";

const PAGE_SIZE = 20;

function groupByDate(entries: ActivityLogEntry[]) {
  const groups: { header: string; entries: ActivityLogEntry[] }[] = [];

  for (const entry of entries) {
    const date = new Date(entry.created_at);
    const header = isToday(date)
      ? "Today"
      : isYesterday(date)
        ? "Yesterday"
        : format(date, "d MMMM");

    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.header === header) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ header, entries: [entry] });
    }
  }

  return groups;
}

export default function ActivityPage() {
  const { user, isReady } = useRequireRole("parent");
  const [passportId, setPassportId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data: passport } = await supabase
        .from("passports")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!isMounted) return;

      if (!passport?.id) {
        setIsLoading(false);
        return;
      }

      setPassportId(passport.id);

      const { data } = await supabase
        .from("activity_log")
        .select("id, event_type, event_description, created_at")
        .eq("passport_id", passport.id)
        .order("created_at", { ascending: false })
        .range(0, PAGE_SIZE - 1);

      if (!isMounted) return;
      const rows = (data ?? []) as ActivityLogEntry[];
      setEntries(rows);
      setHasMore(rows.length === PAGE_SIZE);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user]);

  async function loadMore() {
    if (!passportId || isLoadingMore) return;
    setIsLoadingMore(true);

    const supabase = createClient();
    const { data } = await supabase
      .from("activity_log")
      .select("id, event_type, event_description, created_at")
      .eq("passport_id", passportId)
      .order("created_at", { ascending: false })
      .range(entries.length, entries.length + PAGE_SIZE - 1);

    const rows = (data ?? []) as ActivityLogEntry[];
    setEntries((prev) => [...prev, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    setIsLoadingMore(false);
  }

  if (!isReady) {
    return null;
  }

  const groups = groupByDate(entries);

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
        ) : entries.length === 0 ? (
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
                    <ActivityRow key={entry.id} entry={entry} />
                  ))}
                </div>
              </section>
            ))}

            {hasMore && (
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
