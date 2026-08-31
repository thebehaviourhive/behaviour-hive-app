"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getRagStatus, RAG_TIER_ORDER, type RagStatus } from "@/lib/ragStatus";
import { useTeacherPassports, type TeacherPassport } from "./useTeacherPassports";

type SleepQuality = "slept_through" | "woke_briefly" | "very_restless" | "barely_slept" | null;
type RegulationState = "settled" | "unsettled" | "dysregulated" | null;

// PRD 3, Stage 5 -- one guardian's own account of the morning, plural
// now: a child can have more than one today, and each stays separate,
// attributed by name, never merged into one.
export interface CheckinAccount {
  submittedByName: string | null;
  sleepQuality: SleepQuality;
  regulationState: RegulationState;
  morningStressors: string[];
  headsUp: string | null;
  submittedAt: string;
}

export interface MorningPupilStatus {
  passportId: string;
  firstName: string;
  displayName: string;
  // Worst-of-all-accounts -- if either guardian reports dysregulation,
  // the child sorts red. A false "looks fine" from averaging or picking
  // one account arbitrarily is worse than a settled child getting an
  // early check-in they didn't need.
  rag: RagStatus;
  checkins: CheckinAccount[];
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

// The worst (lowest RAG_TIER_ORDER) tier across every account for this
// child today. A child with zero accounts stays grey, matching
// getRagStatus(null)'s own existing behaviour.
function worstRag(checkins: CheckinAccount[]): RagStatus {
  if (checkins.length === 0) return "grey";
  let worst: RagStatus = "grey";
  for (const c of checkins) {
    const tier = getRagStatus({ regulationState: c.regulationState, sleepQuality: c.sleepQuality });
    if (RAG_TIER_ORDER[tier] < RAG_TIER_ORDER[worst]) worst = tier;
  }
  return worst;
}

// passportsOverride: optional, additive -- when provided, this hook
// enriches THAT list with morning check-ins instead of calling
// useTeacherPassports() itself. Every existing caller (teacher/
// dashboard, teacher/morning-updates) omits it and is completely
// unaffected. Added for /sna/passports specifically, whose own
// useSnaChildren() hook merges three access sources (Stage 2 + 3),
// not just passport_access -- this lets that merged list reuse the
// SAME RAG/sort logic rather than duplicating it.
export function useTeacherMorningCheckins(
  userId: string | null,
  passportsOverride?: { isLoading: boolean; error: string | null; passports: TeacherPassport[] }
): UseTeacherMorningCheckinsResult {
  const ownResult = useTeacherPassports(passportsOverride ? null : userId);
  const isLoadingPassports = passportsOverride ? passportsOverride.isLoading : ownResult.isLoading;
  const passportsError = passportsOverride ? passportsOverride.error : ownResult.error;
  const passports = passportsOverride ? passportsOverride.passports : ownResult.passports;

  const [isLoadingCheckins, setIsLoadingCheckins] = useState(true);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [pupils, setPupils] = useState<MorningPupilStatus[]>([]);

  useEffect(() => {
    if (isLoadingPassports) return;

    if (passports.length === 0) {
      // Resets pupils when the upstream passport list shrinks to zero
      // (e.g. a teacher's last remaining access is revoked while the
      // dashboard is open) -- a genuine reset-on-change, not state
      // derivable from a single render's inputs alone.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPupils([]);
      setIsLoadingCheckins(false);
      return;
    }

    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      // PRD 3, Stage 5 -- get_todays_checkins_for_passports() resolves
      // each submitter's name (a plain client select can't join
      // auth.users) and, deliberately, does NOT reduce to one row per
      // child -- that reduction used to be correct (two rows meant a
      // resubmission) but now silently drops a second guardian's real,
      // different account. Every row from today comes back; grouping
      // by passport_id happens here, in full.
      const { data: checkinRows, error } = await supabase.rpc("get_todays_checkins_for_passports", {
        p_passport_ids: passports.map((p) => p.passportId),
        p_start_of_today: startOfToday.toISOString(),
      });

      if (!isMounted) return;

      if (error) {
        setCheckinError(error.message);
        setIsLoadingCheckins(false);
        return;
      }

      const checkinsByPassport = new Map<string, CheckinAccount[]>();
      for (const row of checkinRows ?? []) {
        const account: CheckinAccount = {
          submittedByName: row.submitted_by_name,
          sleepQuality: row.sleep_quality as SleepQuality,
          regulationState: row.regulation_state as RegulationState,
          morningStressors: row.morning_stressors ?? [],
          headsUp: row.heads_up,
          submittedAt: row.submitted_at,
        };
        const existing = checkinsByPassport.get(row.passport_id);
        if (existing) {
          existing.push(account);
        } else {
          checkinsByPassport.set(row.passport_id, [account]);
        }
      }

      const merged: MorningPupilStatus[] = passports.map((passport) => {
        const checkins = checkinsByPassport.get(passport.passportId) ?? [];
        return {
          passportId: passport.passportId,
          firstName: passport.firstName,
          displayName: passport.displayName,
          rag: worstRag(checkins),
          checkins,
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
