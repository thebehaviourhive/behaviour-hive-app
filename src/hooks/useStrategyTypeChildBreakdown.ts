"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InsightsSetting } from "./useClinicianStrategyInsights";

export interface StrategyTypeChildBreakdownRow {
  passportId: string;
  childName: string;
  ratingCount: number;
  helpedCount: number;
  partlyCount: number;
  notCount: number;
  homeRatingCount: number;
  homeHelpedCount: number;
  schoolRatingCount: number;
  schoolHelpedCount: number;
}

interface RawBreakdownRow {
  passport_id: string;
  child_name: string;
  rating_count: number;
  helped_count: number;
  partly_count: number;
  not_count: number;
  home_rating_count: number;
  home_helped_count: number;
  school_rating_count: number;
  school_helped_count: number;
}

function mapRow(row: RawBreakdownRow): StrategyTypeChildBreakdownRow {
  return {
    passportId: row.passport_id,
    childName: row.child_name,
    ratingCount: row.rating_count,
    helpedCount: row.helped_count,
    partlyCount: row.partly_count,
    notCount: row.not_count,
    homeRatingCount: row.home_rating_count,
    homeHelpedCount: row.home_helped_count,
    schoolRatingCount: row.school_rating_count,
    schoolHelpedCount: row.school_helped_count,
  };
}

// Stage 4's drill-down: "tapping a type drills into the per-child
// breakdown". strategyTypeId is deliberately `string | null | undefined`
// -- undefined/no selection means "don't fetch at all" (typeId is null
// below), and null itself is a real, meaningful value ("the Untagged
// bucket"), matching the new get_clinician_strategy_type_child_breakdown
// RPC's own IS NOT DISTINCT FROM semantics (migration 0058). Passing
// `undefined` to the RPC would NOT correctly select Untagged the way
// `null` does, so the two are kept strictly distinct here rather than
// collapsing "no selection" and "Untagged" onto the same falsy value.
export function useStrategyTypeChildBreakdown(
  strategyTypeId: string | null | undefined,
  setting: InsightsSetting,
  periodDays: number | null
) {
  const [rows, setRows] = useState<StrategyTypeChildBreakdownRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSelected = strategyTypeId !== undefined;

  const load = useCallback(async () => {
    if (!isSelected) {
      setRows(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_clinician_strategy_type_child_breakdown", {
      p_strategy_type_id: strategyTypeId,
      p_setting: setting,
      p_period_days: periodDays,
    });

    if (rpcError) {
      console.error("Failed to load strategy type child breakdown:", rpcError);
      setError("Couldn't load the per-child breakdown.");
      setIsLoading(false);
      return;
    }

    setRows(((data ?? []) as RawBreakdownRow[]).map(mapRow));
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isSelected is derived from strategyTypeId itself (strategyTypeId !== undefined); including both would be redundant, and strategyTypeId already covers every case (undefined -> no-op branch above, null -> Untagged, a real id -> that type).
  }, [strategyTypeId, setting, periodDays]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { rows, isLoading, error, reload: load };
}
