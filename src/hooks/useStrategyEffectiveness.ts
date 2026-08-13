"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Parent-facing "Helped N times" counter (Stage 2, "small parent-visible
// warmth" -- constraint 1: sample counts visible, never confident stats
// on thin data; constraint on this specific surface: "no negative
// counters on the parent surface"). Calls the same get_strategy_effectiveness
// RPC (migration 0055) Stage 3's Clinical File Effectiveness view will
// use -- this hook only needs the one number per strategy it actually
// renders, not the full rollup shape (home/school split, timeline,
// etc. all get discarded here).
export function useStrategyEffectiveness(passportId: string) {
  // Keyed by passport_clinical_content.id (== strategy_content_id) --
  // the same id ClinicalContentItem.id already is, so ClinicalTeamSection
  // can look a count up with nothing more than the item it's already
  // rendering.
  const [helpedCounts, setHelpedCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .rpc("get_strategy_effectiveness", { p_passport_id: passportId })
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to load strategy effectiveness:", error);
          setIsLoading(false);
          return;
        }
        const counts: Record<string, number> = {};
        for (const row of (data ?? []) as { strategy_content_id: string; home_helped: number; school_helped: number }[]) {
          const total = row.home_helped + row.school_helped;
          // "No negative counters on the parent surface": a strategy
          // with only partly/not ratings (helped total of 0) shows
          // nothing at all here, same as a strategy with zero ratings --
          // this is warmth-only, never a way to surface "isn't working".
          if (total > 0) counts[row.strategy_content_id] = total;
        }
        setHelpedCounts(counts);
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  return { helpedCounts, isLoading };
}
