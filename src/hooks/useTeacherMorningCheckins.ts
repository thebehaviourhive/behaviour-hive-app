"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getRagStatus, RAG_TIER_ORDER, type RagStatus } from "@/lib/ragStatus";
import { useTeacherPassports } from "./useTeacherPassports";

type SleepQuality = "slept_through" | "woke_briefly" | "very_restless" | "barely_slept" | null;
type RegulationState = "settled" | "unsettled" | "dysregulated" | null;

export interface MorningPupilStatus {
  passportId: string;
  firstName: string;
  rag: RagStatus;
  sleepQuality: SleepQuality;
  regulationState: RegulationState;
  morningStressors: string[];
  headsUp: string | null;
  checkedInAt: string | null;
}

interface UseTeacherMorningCheckinsResult {
  isLoading: boolean;
  error: string | null;
  pupils: MorningPupilStatus[];
  redAlertCount: number;
}

// Sort is strict per the brief: red, then amber, then green, then grey
// (no check-in), tie-broken alphabetically by first name -- reuses
// RAG_TIER_ORDER rather than re-deriving a parallel ranking.
function sortPupils(pupils: MorningPupilStatus[]): MorningPupilStatus[] {
  return [...pupils].sort((a, b) => {
    const tierDiff = RAG_TIER_ORDER[a.rag] - RAG_TIER_ORDER[b.rag];
    if (tierDiff !== 0) return tierDiff;
    return a.firstName.localeCompare(b.firstName);
  });
}

export function useTeacherMorningCheckins(userId: string | null): UseTeacherMorningCheckinsResult {
  const {
    isLoading: isLoadingPassports,
    error: passportsError,
    passports,
  } = useTeacherPassports(userId);

  const [isLoadingCheckins, setIsLoadingCheckins] = useState(true);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [pupils, setPupils] = useState<MorningPupilStatus[]>([]);

  useEffect(() => {
    if (isLoadingPassports) return;

    if (passports.length === 0) {
      setPupils([]);
      setIsLoadingCheckins(false);
      return;
    }

    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const { data: checkinRows, error } = await supabase
        .from("morning_checkins")
        .select("passport_id, sleep_quality, regulation_state, morning_stressors, heads_up, checked_in_at")
        .in(
          "passport_id",
          passports.map((p) => p.passportId)
        )
        .gte("checked_in_at", startOfToday.toISOString())
        .order("checked_in_at", { ascending: false });

      if (!isMounted) return;

      if (error) {
        setCheckinError(error.message);
        setIsLoadingCheckins(false);
        return;
      }

      // Most recent check-in wins if a child has more than one row today —
      // rows are already ordered newest first.
      const checkinByPassport = new Map<string, (typeof checkinRows)[number]>();
      for (const row of checkinRows ?? []) {
        if (!checkinByPassport.has(row.passport_id)) {
          checkinByPassport.set(row.passport_id, row);
        }
      }

      const merged: MorningPupilStatus[] = passports.map((passport) => {
        const checkin = checkinByPassport.get(passport.passportId) ?? null;
        return {
          passportId: passport.passportId,
          firstName: passport.firstName,
          rag: getRagStatus(
            checkin
              ? {
                  regulationState: checkin.regulation_state as RegulationState,
                  sleepQuality: checkin.sleep_quality as SleepQuality,
                }
              : null
          ),
          sleepQuality: (checkin?.sleep_quality as SleepQuality) ?? null,
          regulationState: (checkin?.regulation_state as RegulationState) ?? null,
          morningStressors: checkin?.morning_stressors ?? [],
          headsUp: checkin?.heads_up ?? null,
          checkedInAt: checkin?.checked_in_at ?? null,
        };
      });

      setPupils(sortPupils(merged));
      setIsLoadingCheckins(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [isLoadingPassports, passports]);

  return {
    isLoading: isLoadingPassports || isLoadingCheckins,
    error: passportsError ?? checkinError,
    pupils,
    redAlertCount: pupils.filter((p) => p.rag === "red").length,
  };
}
