"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AFLS_DOMAINS } from "@/lib/fba/types";
import type { InstrumentItem } from "@/lib/fba/types";

// Independent read of the same fba_instruments item bank AflsSection.tsx
// (the input/scoring tool, explicitly out of bounds for this redesign)
// already fetches -- deliberately its own hook rather than a shared one,
// so the results-display surfaces have no dependency on that component
// at all. Same query shape, same domain grouping.
export function useAflsItemBank() {
  const [itemsByDomain, setItemsByDomain] = useState<Record<string, InstrumentItem[]> | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("fba_instruments")
      .select("items")
      .eq("instrument_type", "afls")
      .eq("is_active", true)
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error || !data) {
          setLoadError(true);
          return;
        }
        const grouped: Record<string, InstrumentItem[]> = {};
        for (const domain of AFLS_DOMAINS) grouped[domain] = [];
        for (const row of data as { items: InstrumentItem[] }[]) {
          for (const item of row.items) {
            const domain = item.category ?? "Other";
            grouped[domain] = grouped[domain] ? [...grouped[domain], item] : [item];
          }
        }
        setItemsByDomain(grouped);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return { itemsByDomain, loadError };
}
