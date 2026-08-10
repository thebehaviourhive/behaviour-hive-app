"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InstrumentItem } from "@/lib/fba/types";

// Module-scoped cache, not persisted storage: the QABF/MAS/Open-Ended
// item banks are one row each in fba_instruments and effectively static
// reference data for the lifetime of a page session, so re-fetching them
// on every section visit/every completed request card is wasted work.
// This is read-only reference-data memoization, not the kind of local
// caching layer Stage 1 was told not to build for FBA content itself.
const cache = new Map<string, InstrumentItem[]>();

export function useInstrumentItems(instrumentType: string | null) {
  const [items, setItems] = useState<InstrumentItem[] | null>(
    instrumentType ? (cache.get(instrumentType) ?? null) : null
  );
  const [isLoading, setIsLoading] = useState(Boolean(instrumentType) && !cache.has(instrumentType ?? ""));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!instrumentType) return;
    if (cache.has(instrumentType)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(cache.get(instrumentType) ?? null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    supabase
      .from("fba_instruments")
      .select("items")
      .eq("instrument_type", instrumentType)
      .eq("is_active", true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error || !data) {
          console.error("Failed to load instrument item bank:", error);
          setLoadError("Couldn't load the questionnaire items.");
          setIsLoading(false);
          return;
        }
        const fetched = (data.items as InstrumentItem[]) ?? [];
        cache.set(instrumentType, fetched);
        setItems(fetched);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [instrumentType]);

  return { items, isLoading, loadError };
}
