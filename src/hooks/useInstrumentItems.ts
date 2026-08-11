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
//
// Keyed by "instrumentType:version" once a specific version has been
// resolved, not just instrumentType -- see the responseAnswerKeys
// handling below for why more than one version can matter.
const cache = new Map<string, InstrumentItem[]>();

interface InstrumentRow {
  items: InstrumentItem[];
  version: number;
  is_active: boolean;
}

// `responseAnswerKeys` (typically Object.keys(request.responsesData))
// lets a caller resolve the CORRECT historical item-bank version for a
// response that was answered against an OLDER one -- needed after
// migration 0044 version-bumped open_ended: the one pre-existing
// completed response there was answered against version 1's
// "interview-N" item ids, but the active row is now version 2's
// "fai-N" items. Fetching only is_active=true (the old behaviour) would
// show the CURRENT question text next to that response while looking
// up answers by ids that no longer exist in it -- every item reading as
// unanswered. QABF/MAS only ever have one version in practice, so
// passing this for them is a harmless no-op.
export function useInstrumentItems(instrumentType: string | null, responseAnswerKeys?: string[]) {
  const hasAnswerKeys = Boolean(responseAnswerKeys && responseAnswerKeys.length > 0);
  const [items, setItems] = useState<InstrumentItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(instrumentType));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!instrumentType) return;

    // The plain "just show me the active item bank" path (no version
    // disambiguation needed) still benefits from the simple cache.
    const simpleCacheKey = `${instrumentType}:active`;
    if (!hasAnswerKeys && cache.has(simpleCacheKey)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(cache.get(simpleCacheKey) ?? null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    supabase
      .from("fba_instruments")
      .select("items, version, is_active")
      .eq("instrument_type", instrumentType)
      .order("version", { ascending: false })
      .then(({ data, error }) => {
        if (!isMounted) return;
        const rows = data as InstrumentRow[] | null;
        if (error || !rows || rows.length === 0) {
          console.error("Failed to load instrument item bank:", error);
          setLoadError("Couldn't load the questionnaire items.");
          setIsLoading(false);
          return;
        }

        let chosen = rows.find((row) => row.is_active) ?? rows[0];
        if (responseAnswerKeys && responseAnswerKeys.length > 0) {
          const matched = rows.find((row) => row.items.some((item) => responseAnswerKeys.includes(item.id)));
          if (matched) chosen = matched;
        }

        const fetched = chosen.items ?? [];
        if (!hasAnswerKeys) cache.set(simpleCacheKey, fetched);
        setItems(fetched);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
    // responseAnswerKeys is intentionally read via closure, not listed:
    // for one mounted card it's derived from an immutable completed
    // response and never changes, and re-running on every array
    // identity change (a fresh array literal at most call sites) would
    // defeat the point of the cache above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentType, hasAnswerKeys]);

  return { items, isLoading, loadError };
}
