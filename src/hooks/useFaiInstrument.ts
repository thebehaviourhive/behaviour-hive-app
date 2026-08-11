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

  useEffect(() => {
    let isMounted = true;
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
  }, []);

  return { items, attribution, loadError };
}
