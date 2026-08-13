"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type InsightsSetting = "home" | "school" | null;

export interface StrategyTypeInsightRow {
  strategyTypeId: string | null; // null = "Untagged" (RPC's own coalesce already resolves the label)
  strategyTypeLabel: string;
  childCount: number;
  ratingCount: number;
  helpedCount: number;
  partlyCount: number;
  notCount: number;
  homeRatingCount: number;
  homeHelpedCount: number;
  schoolRatingCount: number;
  schoolHelpedCount: number;
}

interface RawInsightRow {
  strategy_type_id: string | null;
  strategy_type_label: string;
  child_count: number;
  rating_count: number;
  helped_count: number;
  partly_count: number;
  not_count: number;
  home_rating_count: number;
  home_helped_count: number;
  school_rating_count: number;
  school_helped_count: number;
}

function mapRow(row: RawInsightRow): StrategyTypeInsightRow {
  return {
    strategyTypeId: row.strategy_type_id,
    strategyTypeLabel: row.strategy_type_label,
    childCount: row.child_count,
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

// Stage 4's top-level ranked list, reading get_clinician_strategy_type_insights
// (built ahead of time in migration 0055 -- no new SQL for this half of
// Stage 4). Already ranked (order by rating_count desc) and already
// scoped to the caller's own actively-linked cases only -- the RPC
// re-checks is_verified_clinician + is_active clinician_access on every
// call, so a revoked case simply isn't reflected the next time this
// hook fetches, and a second clinician's account gets a completely
// separate result set with no client-side scoping required here.
export function useClinicianStrategyInsights(setting: InsightsSetting, periodDays: number | null) {
  const [rows, setRows] = useState<StrategyTypeInsightRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_clinician_strategy_type_insights", {
      p_setting: setting,
      p_period_days: periodDays,
    });

    if (rpcError) {
      console.error("Failed to load strategy insights:", rpcError);
      setError("Couldn't load strategy insights.");
      setIsLoading(false);
      return;
    }

    setRows(((data ?? []) as RawInsightRow[]).map(mapRow));
    setIsLoading(false);
  }, [setting, periodDays]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { rows, isLoading, error, reload: load };
}
