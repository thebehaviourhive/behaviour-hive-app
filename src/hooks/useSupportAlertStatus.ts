"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Support Button, nav rework -- the poll loop. Every 5s while the nav
// is mounted (which is everywhere except /calm's own full-screen flow),
// backed by get_my_support_alert_status() (0154), a single-row
// purpose-built RPC riding the existing partial index -- close to free
// when nothing is open, which is the overwhelmingly common case.
//
// 5s, not 20-30s: Daniel's own correction -- this is the one feature
// where a delay IS the cost. "Support Requested" is a summons, not a
// notification; a teacher who needs a room full of adults doesn't
// benefit from an alert arriving 25 seconds late. At 5s, a trial
// school of 15-30 staff polling simultaneously is 3-6 requests/second
// peak (versus ~0.6-1.2/s at 25s) -- five times the traffic, still
// trivial against a partial index that's empty the overwhelming
// majority of the time.
//
// visibilitychange PAUSES the interval while hidden and re-polls
// immediately on return, rather than inventing a new pattern --
// useWakeLock.ts already established exactly this shape for the
// identical underlying problem (iOS suspends JS in a backgrounded tab
// regardless of what the interval says). This does not close the
// phone-locked/app-closed gap -- nothing can, without real push -- it
// only means the state is correct the instant someone looks, instead
// of stale by up to a poll interval.
const POLL_INTERVAL_MS = 5000;

export interface SupportAlertStatus {
  alertId: string;
  isOwn: boolean;
  iAcknowledged: boolean;
  acknowledgementCount: number;
  roomNames: string[];
  raisedByName: string | null;
  raisedAt: string;
  otherOpenAlertCount: number;
}

export function useSupportAlertStatus(institutionId: string | null, userId: string | null) {
  const [status, setStatus] = useState<SupportAlertStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!institutionId || !userId) {
      setIsLoading(false);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_support_alert_status", {
      p_institution_id: institutionId,
    });
    if (error) {
      // Fail quiet -- a single failed poll shouldn't flip the nav to a
      // broken or misleading state. Keep the last-known status; the
      // next successful poll (or the visibility-triggered one) corrects
      // it.
      setIsLoading(false);
      return;
    }
    const row = ((data ?? []) as Record<string, unknown>[])[0] ?? null;
    setStatus(
      row
        ? {
            alertId: row.alert_id as string,
            isOwn: row.is_own as boolean,
            iAcknowledged: row.i_acknowledged as boolean,
            acknowledgementCount: row.acknowledgement_count as number,
            roomNames: (row.room_names as string[] | null) ?? [],
            raisedByName: row.raised_by_name as string | null,
            raisedAt: row.raised_at as string,
            otherOpenAlertCount: (row.other_open_alert_count as number | null) ?? 0,
          }
        : null
    );
    setIsLoading(false);
  }, [institutionId, userId]);

  useEffect(() => {
    let isMounted = true;

    async function initial() {
      await poll();
    }
    initial();

    function startInterval() {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    }
    function stopInterval() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    function handleVisibilityChange() {
      if (!isMounted) return;
      if (document.visibilityState === "visible") {
        poll();
        startInterval();
      } else {
        stopInterval();
      }
    }

    if (document.visibilityState === "visible") startInterval();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [poll]);

  return { status, isLoading, refresh: poll };
}
