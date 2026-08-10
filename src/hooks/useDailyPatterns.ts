"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RegulationState } from "@/lib/fba/dailyPatterns";

export interface MorningCheckinEntry {
  id: string;
  date: string;
  state: RegulationState | null;
  headsUp: string | null;
}

export interface TeacherUpdateEntry {
  id: string;
  date: string;
  state: RegulationState | null;
  flags: string[];
  headsUp: string | null;
}

// Derives the LOCAL calendar date from a timestamptz, not a naive UTC
// slice -- same reasoning as ABCLogger's nowDate(): between local
// midnight and ~1am during BST, a UTC-sliced date would land on the
// wrong day.
function toLocalDateString(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface CheckinRow {
  id: string;
  checked_in_at: string;
  submitted_at: string;
  regulation_state: RegulationState | null;
  heads_up: string | null;
}

interface UpdateRow {
  id: string;
  submitted_at: string;
  settled_state: RegulationState | null;
  flags: string[] | null;
  heads_up: string | null;
}

// Section 8's Daily Patterns panel: the child's full morning check-in +
// teacher EOD update history for this passport, unfiltered -- the
// caller (DirectAssessmentSection) filters/summarizes against the same
// date range already driving the ABC pull, same division of labour as
// useAbcLogs.
export function useDailyPatterns(passportId: string) {
  const [checkins, setCheckins] = useState<MorningCheckinEntry[]>([]);
  const [updates, setUpdates] = useState<TeacherUpdateEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();

    Promise.all([
      supabase
        .from("morning_checkins")
        .select("id, checked_in_at, submitted_at, regulation_state, heads_up")
        .eq("passport_id", passportId)
        .order("submitted_at", { ascending: true }),
      supabase
        .from("teacher_updates")
        .select("id, submitted_at, settled_state, flags, heads_up")
        .eq("passport_id", passportId)
        .order("submitted_at", { ascending: true }),
    ]).then(([checkinsRes, updatesRes]) => {
      if (!isMounted) return;
      if (checkinsRes.error || updatesRes.error) {
        console.error("Failed to load daily patterns:", checkinsRes.error ?? updatesRes.error);
        setLoadError("Couldn't load daily patterns.");
        setIsLoading(false);
        return;
      }
      setCheckins(
        ((checkinsRes.data ?? []) as CheckinRow[]).map((row) => ({
          id: row.id,
          date: toLocalDateString(row.checked_in_at ?? row.submitted_at),
          state: row.regulation_state,
          headsUp: row.heads_up,
        }))
      );
      setUpdates(
        ((updatesRes.data ?? []) as UpdateRow[]).map((row) => ({
          id: row.id,
          date: toLocalDateString(row.submitted_at),
          state: row.settled_state,
          flags: row.flags ?? [],
          headsUp: row.heads_up,
        }))
      );
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [passportId]);

  return { checkins, updates, isLoading, loadError };
}
