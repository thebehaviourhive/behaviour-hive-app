"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AbcTrendEntry } from "@/lib/progress/abc";

interface RawAbcTrendRow {
  id: string;
  incident_date: string;
  logged_by_role: string;
  antecedents: string[] | null;
  behaviours: string[] | null;
  consequences: string[] | null;
}

// Stage B's ABC data pull for the Progress feature (frequency, day-of-week,
// and antecedent/behaviour/consequence breakdown charts) -- via
// get_abc_trend_data() (migration 0051), which structurally omits
// perceived_function/general_notes/clinical_notes. Safe for all three
// roles: the function chart (clinician-only) reads through the separate
// useAbcFunctionData hook instead, never this one.
export function useAbcTrendData(passportId: string) {
  const [entries, setEntries] = useState<AbcTrendEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    supabase
      .rpc("get_abc_trend_data", { p_passport_id: passportId })
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to load ABC trend data:", error);
          setLoadError("Couldn't load incident data.");
          setIsLoading(false);
          return;
        }
        setEntries(
          ((data ?? []) as RawAbcTrendRow[]).map((row) => ({
            id: row.id,
            incidentDate: row.incident_date,
            loggedByRole: row.logged_by_role,
            antecedents: row.antecedents ?? [],
            behaviours: row.behaviours ?? [],
            consequences: row.consequences ?? [],
          }))
        );
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  return { entries, isLoading, loadError };
}
