"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Outstanding-task snoozing, 25 Sept 2026. One hook, called once per
// dashboard page (not once per bucket) -- get_institution_snooze_
// status() already returns every queue_key's own snoozes for the
// institution in one call, so there's nothing to gain from fetching it
// per-bucket, and doing it once avoids N near-identical round trips on
// a page with a dozen buckets (principal/dashboard has ten).

export interface SnoozeMeta {
  isCurrentlySnoozed: boolean;
  snoozedUntil: string;
  snoozeCount: number;
  lastReason: string;
  lastSnoozedByName: string | null;
  lastSnoozedAt: string;
}

interface SnoozeStatusRow {
  queue_key: string;
  item_id: string;
  is_currently_snoozed: boolean;
  snoozed_until: string;
  snooze_count: number;
  last_reason: string;
  last_snoozed_by: string;
  last_snoozed_by_name: string | null;
  last_snoozed_at: string;
}

function key(queueKey: string, itemId: string): string {
  return `${queueKey}:${itemId}`;
}

export function useOutstandingTaskSnoozes(institutionId: string | null) {
  const [statusMap, setStatusMap] = useState<Map<string, SnoozeMeta>>(new Map());
  const [defaultSnoozeDays, setDefaultSnoozeDays] = useState(5);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!institutionId) {
      setIsLoading(false);
      return;
    }
    const supabase = createClient();
    const [{ data: statusRows, error: statusError }, { data: instRow }] = await Promise.all([
      supabase.rpc("get_institution_snooze_status", { p_institution_id: institutionId }),
      supabase.from("institutions").select("default_snooze_days").eq("id", institutionId).maybeSingle(),
    ]);

    if (!statusError) {
      const map = new Map<string, SnoozeMeta>();
      for (const row of (statusRows ?? []) as SnoozeStatusRow[]) {
        map.set(key(row.queue_key, row.item_id), {
          isCurrentlySnoozed: row.is_currently_snoozed,
          snoozedUntil: row.snoozed_until,
          snoozeCount: row.snooze_count,
          lastReason: row.last_reason,
          lastSnoozedByName: row.last_snoozed_by_name,
          lastSnoozedAt: row.last_snoozed_at,
        });
      }
      setStatusMap(map);
    }
    if (instRow?.default_snooze_days) {
      setDefaultSnoozeDays(instRow.default_snooze_days);
    }
    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const getMeta = useCallback(
    (queueKey: string, itemId: string): SnoozeMeta | undefined => statusMap.get(key(queueKey, itemId)),
    [statusMap]
  );

  // Default view: hide anything currently snoozed. "Show snoozed"
  // reveals everything, snoozed or not, so a colleague can see (and
  // re-snooze, or just read the trail on) an item that's out of the
  // default view -- never a dead end with no way back, per the brief's
  // own "if they disappear with no way back, this is a delete, not a
  // snooze."
  const filterVisible = useCallback(
    <T,>(items: T[], queueKey: string, getItemId: (item: T) => string): T[] => {
      if (showSnoozed) return items;
      return items.filter((item) => !getMeta(queueKey, getItemId(item))?.isCurrentlySnoozed);
    },
    [showSnoozed, getMeta]
  );

  return { isLoading, defaultSnoozeDays, showSnoozed, setShowSnoozed, getMeta, filterVisible, refresh };
}

export type UseOutstandingTaskSnoozesResult = ReturnType<typeof useOutstandingTaskSnoozes>;
