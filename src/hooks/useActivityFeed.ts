"use client";

import { useCallback, useEffect, useState } from "react";
import { format, isToday, isYesterday } from "date-fns";

// Extracted from parent/teacher/clinician's own activity pages (and the
// teacher/clinician dashboard preview cards) -- all of them had
// triplicated, byte-identical-aside-from-naming copies of this state
// machine: load-on-mount, cursor-based load-more, grouped-by-date
// display. Adding a principal track (Support Button item 6) would have
// made it a fourth copy of the page-level version; this hook is that
// "not making it worse" fix, done as part of adding the principal
// version rather than as a separate refactor pass nobody asked for.
//
// What did NOT move here, because it genuinely differs per track: the
// RPC name and its params, the row-to-ActivityRow mapping (child-name
// prefixing differs -- parent never prefixes since it's single-child
// context, teacher/clinician do, principal never will since its rows
// are institution-wide by construction), href construction (a different
// incident-detail route per track), and empty-state copy. Those stay in
// each page/card, which is what `fetchPage` below exists for -- the
// caller owns the query shape, this hook owns only the load/paginate/
// group machinery.

export interface ActivityFeedEntryBase {
  id: string;
  created_at: string;
}

export interface ActivityFeedGroup<T> {
  header: string;
  entries: T[];
}

export function groupActivityByDate<T extends ActivityFeedEntryBase>(entries: T[]): ActivityFeedGroup<T>[] {
  const groups: ActivityFeedGroup<T>[] = [];

  for (const entry of entries) {
    const date = new Date(entry.created_at);
    const header = isToday(date) ? "Today" : isYesterday(date) ? "Yesterday" : format(date, "d MMMM");

    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.header === header) {
      lastGroup.entries.push(entry);
    } else {
      groups.push({ header, entries: [entry] });
    }
  }

  return groups;
}

export function useActivityFeed<T extends ActivityFeedEntryBase>({
  fetchPage,
  pageSize = 20,
  enabled = true,
}: {
  // Caller-owned query, e.g.:
  //   useCallback((limit, offset) => supabase.rpc("get_x_activity_feed", { p_limit: limit, p_offset: offset }), [])
  // Wrap in useCallback with the caller's own real dependencies (e.g.
  // passportId) so this hook only refetches when it should.
  fetchPage: (limit: number, offset: number) => Promise<{ data: T[] | null; error: unknown }>;
  pageSize?: number;
  // False while a precondition (useRequireRole's isReady, or a resolved
  // passportId) isn't met yet -- mirrors every existing caller's own
  // "if (!isReady) return" / "if (!passportId) { setIsLoading(false); return }" guard.
  enabled?: boolean;
}) {
  const [entries, setEntries] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);

    const { data, error } = await fetchPage(pageSize, 0);

    if (error) {
      console.error("Failed to load activity feed:", error);
      setLoadError("Couldn't load activity.");
      setIsLoading(false);
      return;
    }

    const rows = data ?? [];
    setEntries(rows);
    setHasMore(rows.length === pageSize);
    setIsLoading(false);
  }, [enabled, fetchPage, pageSize]);

  // Fetches on mount and whenever `load`'s identity changes -- a genuine
  // effect for syncing with the external data source, not a synchronous
  // state derivation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function loadMore() {
    if (!enabled || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    const { data, error } = await fetchPage(pageSize, entries.length);

    if (error) {
      console.error("Failed to load more activity feed:", error);
      setLoadMoreError("Couldn't load more activity.");
      setIsLoadingMore(false);
      return;
    }

    const rows = data ?? [];
    setEntries((prev) => [...prev, ...rows]);
    setHasMore(rows.length === pageSize);
    setIsLoadingMore(false);
  }

  return {
    entries,
    groups: groupActivityByDate(entries),
    isLoading,
    isLoadingMore,
    hasMore,
    loadError,
    loadMoreError,
    load,
    loadMore,
  };
}
