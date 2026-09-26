"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Respite UI Stage 2a -- the dashboard rebuild. Everything the four
// blocks need (Today, Coming and going, Needs doing, Who is on),
// assembled from a small, deliberately RLS-SAFE set of queries -- no
// embedded PostgREST join reaching into `passports` from a table a
// centre_manager/care_staff has no direct grant on (CLAUDE.md's own
// "embedded join across RLS returns empty, not an error" gotcha).
// Names are resolved from get_my_centre_active_children()'s own
// server-side passports join instead, and reused everywhere a
// passport_id needs a display name.
export interface OnSiteChild {
  passportId: string;
  childName: string;
  stayId: string;
  hasMorning: boolean;
  hasEndOfDay: boolean;
  hasLoggedToday: boolean;
}

export interface ScheduleEntry {
  passportId: string;
  childName: string;
  kind: "arrival" | "departure";
  date: string;
}

export interface AwaitingReportRow {
  stay_id: string;
  passport_id: string;
  child_name: string | null;
  ends_at: string;
}

export interface PendingStaffRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_pending: boolean;
}

export function useCentreDashboardOverview(institutionId: string | null) {
  const [onSiteChildren, setOnSiteChildren] = useState<OnSiteChild[]>([]);
  const [totalActivePlacements, setTotalActivePlacements] = useState(0);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [awaitingReport, setAwaitingReport] = useState<AwaitingReportRow[]>([]);
  const [pendingStaff, setPendingStaff] = useState<PendingStaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Baseline audit, 26 Sept 2026 -- none of these seven queries' own
  // `error` was ever read; a failure just left every section holding
  // whatever it already had (empty, on a first load), rendering
  // identically to a genuinely quiet day. error is checked across all
  // seven before any state is set, so a partial failure never produces
  // a partially-updated, seemingly-consistent dashboard.
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!institutionId) return;
    setError(null);
    const supabase = createClient();
    const todayStr = new Date().toISOString().slice(0, 10);
    const windowEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [activeChildrenRes, activationsRes, checkinsRes, abcRes, staysRes, awaitingRes, rosterRes] =
      await Promise.all([
        // Every child with an active placement -- also the only safe
        // source of a display name (server-side join, elevated).
        supabase.rpc("get_my_centre_active_children", { p_institution_id: institutionId }),
        // Who is genuinely ON-SITE right now, and the real stay each
        // one is activated for -- never the loose "most recently
        // started" fallback get_my_centre_active_children() returns.
        supabase
          .from("respite_activations")
          .select("passport_id, stay_id")
          .eq("institution_id", institutionId)
          .is("closed_at", null),
        // Today's check-ins, placement-scoped -- one query for every
        // child at once, not one per row.
        supabase
          .from("respite_stay_checkins")
          .select("stay_id, check_in_type")
          .eq("institution_id", institutionId)
          .eq("check_in_date", todayStr),
        // "Anything logged today" -- ABC entries dated today, for any
        // child with an active placement here (the RLS policy itself
        // already scopes this; no extra filter needed for correctness,
        // institution_id kept for clarity of intent, not enforcement).
        supabase.from("abc_logs").select("passport_id").eq("incident_date", todayStr),
        // Every stay at this centre -- filtered client-side to the
        // next 7 days, for arrivals and departures.
        supabase
          .from("respite_stays")
          .select("id, passport_id, starts_at, ends_at")
          .eq("institution_id", institutionId),
        supabase.rpc("get_respite_stays_awaiting_report", { p_institution_id: institutionId }),
        supabase.rpc("get_institution_staff_roster", {
          p_institution_id: institutionId,
          p_include_pending: true,
        }),
      ]);

    const firstError = [activeChildrenRes, activationsRes, checkinsRes, abcRes, staysRes, awaitingRes, rosterRes]
      .map((r) => r.error)
      .find((e) => e);
    if (firstError) {
      console.error("Failed to load centre dashboard overview:", firstError);
      setError("Couldn't load your dashboard. Please try again.");
      setIsLoading(false);
      return;
    }

    const nameByPassportId = new Map<string, string>();
    const activeChildren = (activeChildrenRes.data ?? []) as { passport_id: string; child_name: string | null }[];
    for (const row of activeChildren) {
      nameByPassportId.set(row.passport_id, row.child_name ?? "This child");
    }
    setTotalActivePlacements(activeChildren.length);

    const openActivations = (activationsRes.data ?? []) as { passport_id: string; stay_id: string }[];

    const checkinsByStay = new Map<string, { morning: boolean; endOfDay: boolean }>();
    for (const row of (checkinsRes.data ?? []) as { stay_id: string; check_in_type: string }[]) {
      const entry = checkinsByStay.get(row.stay_id) ?? { morning: false, endOfDay: false };
      if (row.check_in_type === "morning") entry.morning = true;
      else entry.endOfDay = true;
      checkinsByStay.set(row.stay_id, entry);
    }

    const loggedTodayPassportIds = new Set(
      ((abcRes.data ?? []) as { passport_id: string }[]).map((r) => r.passport_id)
    );

    setOnSiteChildren(
      openActivations.map((a) => {
        const checkins = checkinsByStay.get(a.stay_id) ?? { morning: false, endOfDay: false };
        return {
          passportId: a.passport_id,
          childName: nameByPassportId.get(a.passport_id) ?? "This child",
          stayId: a.stay_id,
          hasMorning: checkins.morning,
          hasEndOfDay: checkins.endOfDay,
          hasLoggedToday: loggedTodayPassportIds.has(a.passport_id),
        };
      })
    );

    const now = Date.now();
    const scheduleEntries: ScheduleEntry[] = [];
    for (const stay of (staysRes.data ?? []) as { id: string; passport_id: string; starts_at: string; ends_at: string }[]) {
      const childName = nameByPassportId.get(stay.passport_id) ?? "This child";
      const startsAt = new Date(stay.starts_at).getTime();
      const endsAt = new Date(stay.ends_at).getTime();
      if (startsAt >= now && startsAt <= windowEnd.getTime()) {
        scheduleEntries.push({ passportId: stay.passport_id, childName, kind: "arrival", date: stay.starts_at });
      }
      if (endsAt >= now && endsAt <= windowEnd.getTime()) {
        scheduleEntries.push({ passportId: stay.passport_id, childName, kind: "departure", date: stay.ends_at });
      }
    }
    scheduleEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setSchedule(scheduleEntries);

    setAwaitingReport((awaitingRes.data ?? []) as AwaitingReportRow[]);
    setPendingStaff(((rosterRes.data ?? []) as PendingStaffRow[]).filter((s) => s.is_pending));

    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    load();
  }, [load]);

  return {
    onSiteChildren,
    totalActivePlacements,
    schedule,
    awaitingReport,
    pendingStaff,
    isLoading,
    error,
    refresh: load,
  };
}
