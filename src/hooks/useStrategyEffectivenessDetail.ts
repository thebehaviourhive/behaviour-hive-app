"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type StrategyItemType = "strategy_home" | "strategy_school" | "strategy_shared";
export type StrategyRatingValue = "helped" | "partly" | "not";

export interface StrategyRatingsTimelinePoint {
  rating: StrategyRatingValue;
  createdAt: string;
}

export interface StrategyEffectivenessRow {
  strategyContentId: string;
  itemType: StrategyItemType;
  title: string;
  strategyTypeId: string | null;
  homeHelped: number;
  homePartly: number;
  homeNot: number;
  schoolHelped: number;
  schoolPartly: number;
  schoolNot: number;
  totalRatings: number;
  ratingsTimeline: StrategyRatingsTimelinePoint[];
}

// Raw shape of a get_strategy_effectiveness() row, straight off the RPC
// (see migration 0055) -- snake_case, mapped to StrategyEffectivenessRow
// below. Built in Stage 1 specifically for this Stage 3 consumer (and
// Stage 4's caseload rollup), so no new SQL is needed here.
interface RawEffectivenessRow {
  strategy_content_id: string;
  item_type: StrategyItemType;
  title: string;
  strategy_type_id: string | null;
  home_helped: number;
  home_partly: number;
  home_not: number;
  school_helped: number;
  school_partly: number;
  school_not: number;
  total_ratings: number;
  ratings_timeline: { rating: StrategyRatingValue; created_at: string }[];
}

function mapRow(row: RawEffectivenessRow): StrategyEffectivenessRow {
  return {
    strategyContentId: row.strategy_content_id,
    itemType: row.item_type,
    title: row.title,
    strategyTypeId: row.strategy_type_id,
    homeHelped: row.home_helped,
    homePartly: row.home_partly,
    homeNot: row.home_not,
    schoolHelped: row.school_helped,
    schoolPartly: row.school_partly,
    schoolNot: row.school_not,
    totalRatings: row.total_ratings,
    ratingsTimeline: (row.ratings_timeline ?? []).map((p) => ({ rating: p.rating, createdAt: p.created_at })),
  };
}

// The Clinical File's own "Effectiveness" tab (Stage 3): the full,
// clinician-scoped detail behind get_strategy_effectiveness(), unlike
// useStrategyEffectiveness.ts (Stage 2's parent-facing hook), which
// deliberately collapses everything to one "helped N times" number and
// drops zero-total strategies. Here every strategy is kept (including
// zero-rating ones -- rendered as "No ratings yet" by the caller) and
// every count/timeline field survives, since the Effectiveness view
// needs the full home/school split and the ratings_timeline for its
// sparkline.
//
// No extra client-side authorization check is needed: the RPC itself
// enforces owns_passport(...) OR (verified clinician with an active
// clinician_access row) and raises an exception otherwise -- exactly
// the "verified + active link on every new RPC" privacy-wall
// requirement, already built in Stage 1. A revoked or never-linked
// clinician (including via direct URL manipulation to a passportId
// outside their caseload) gets that exception surfaced as `error`
// below, not silently empty data.
export function useStrategyEffectivenessDetail(passportId: string) {
  const [rows, setRows] = useState<StrategyEffectivenessRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Same shape as usePassportClinicalContent's own load/reload: a
  // useCallback'd fetch, invoked from the effect below via a single
  // disable comment on the call itself -- not scattered setState calls
  // directly in the effect body.
  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_strategy_effectiveness", {
      p_passport_id: passportId,
    });

    if (rpcError) {
      console.error("Failed to load strategy effectiveness:", rpcError);
      setError("Couldn't load strategy effectiveness.");
      setIsLoading(false);
      return;
    }

    setRows(((data ?? []) as RawEffectivenessRow[]).map(mapRow));
    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { rows, isLoading, error, reload: load };
}
