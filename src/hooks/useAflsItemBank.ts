"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AFLS_DOMAINS } from "@/lib/fba/types";
import type { InstrumentItem } from "@/lib/fba/types";

// The single shared read of the fba_instruments AFLS item bank (real
// 225-task content, migration 0060) -- used by both the entry tool
// (AflsSection.tsx) and every results-display surface, so a later
// clinical spot-check correction to item text/max/naRule (a data
// UPDATE, never a code change) shows up identically everywhere without
// two fetch paths to keep in sync. Grouped by domain CODE (e.g. "SM"),
// matching AFLS_DOMAINS and the item's own `category` field exactly.
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
        for (const domain of AFLS_DOMAINS) grouped[domain.code] = [];
        for (const row of data as { items: InstrumentItem[] }[]) {
          for (const item of row.items) {
            const domainCode = item.category ?? "Other";
            grouped[domainCode] = grouped[domainCode] ? [...grouped[domainCode], item] : [item];
          }
        }
        // Each task's own code sorts numerically within its domain
        // (SM1, SM2, … SM25, not SM1, SM10, SM11, … lexicographically).
        for (const domainCode of Object.keys(grouped)) {
          grouped[domainCode] = [...grouped[domainCode]].sort(
            (a, b) => parseInt(a.id.replace(/^\D+/, ""), 10) - parseInt(b.id.replace(/^\D+/, ""), 10)
          );
        }
        setItemsByDomain(grouped);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return { itemsByDomain, loadError };
}
