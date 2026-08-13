"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface StrategyTypeOption {
  id: string;
  label: string;
}

// The controlled vocabulary from strategy_types (migration 0055).
// Read-only for any authenticated user (no passport scoping needed --
// it's a shared reference list, not per-child data). Fetched once by
// whichever authoring surface needs it (RecommendationsSection,
// CalmCardSection) and passed down, rather than re-fetched per entry.
export function useStrategyTypes() {
  const [options, setOptions] = useState<StrategyTypeOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("strategy_types")
      .select("id, label")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to load strategy types:", error);
          setIsLoading(false);
          return;
        }
        setOptions((data ?? []) as StrategyTypeOption[]);
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return { options, isLoading };
}
