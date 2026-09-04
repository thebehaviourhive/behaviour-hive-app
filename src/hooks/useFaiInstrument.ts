"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InstrumentItem } from "@/lib/fba/types";

// The active Open-Ended FAI item bank + its attribution, for the
// clinician-completed interview form and the reader/print Q&A display.
// Deliberately separate from useInstrumentItems (which only ever
// returns items, no attribution, and is shared with QABF/MAS and the
// recipient-facing questionnaire flow) -- faiInterviews are only ever
// recorded against whatever's currently active, so there's no legacy-
// version disambiguation to do here the way InstrumentResultCard has to
// for the one pre-existing sendable-era open_ended response.
export function useFaiInstrument() {
  const [items, setItems] = useState<InstrumentItem[] | null>(null);
  const [attribution, setAttribution] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Background pass, "the ~17 window.location.reload() sites" -- lets a
  // caller's own error-retry button re-run this hook's load effect in
  // place instead of a hard browser reload.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(null);
    const supabase = createClient();
    supabase
      .from("fba_instruments")
      .select("items, attribution")
      .eq("instrument_type", "open_ended")
      .eq("is_active", true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error || !data) {
          console.error("Failed to load the FAI item bank:", error);
          setLoadError("Couldn't load the interview questions.");
          return;
        }
        setItems((data.items as InstrumentItem[]) ?? []);
        setAttribution(data.attribution ?? null);
      });
    return () => {
      isMounted = false;
    };
  }, [reloadKey]);

  return { items, attribution, loadError, refresh: () => setReloadKey((k) => k + 1) };
}
