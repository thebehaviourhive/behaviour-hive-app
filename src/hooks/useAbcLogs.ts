"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AbcLogSummary } from "@/lib/fba/abcAnalysis";

interface RawAbcLogRow {
  id: string;
  incident_date: string;
  incident_time: string;
  logged_by_name: string | null;
  logged_by_role: string;
  duration_minutes: number | null;
  intensity: number;
  antecedents: string[] | null;
  antecedent_other: string | null;
  behaviours: string[] | null;
  behaviour_other: string | null;
  consequences: string[] | null;
  consequence_other: string | null;
  sensory_sought: string[] | null;
  sensory_avoided: string[] | null;
  sensory_sought_other: string | null;
  sensory_avoided_other: string | null;
  perceived_function: string | null;
  perceived_function_other: string | null;
  general_notes: string | null;
}

// Section 8's read-only pull of a child's full ABC history -- via the
// same get_abc_logs() RPC every other track already uses (a verified,
// actively-linked clinician already has access, confirmed against
// migration 0029; no new RLS needed for this). No date-range param on
// the RPC itself, so the range filter is applied client-side against
// this one fetch, same as ABCTimeline's intensity/reporter filters.
// Structurally excludes clinical_notes, same as every other caller --
// this is "as the clinician normally sees it" via this RPC, not a
// narrower view.
export function useAbcLogs(passportId: string) {
  const [logs, setLogs] = useState<AbcLogSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Background pass, "the ~17 window.location.reload() sites" -- lets a
  // caller's own error-retry button re-run this hook's load effect in
  // place instead of a hard browser reload.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    supabase
      .rpc("get_abc_logs", { p_passport_id: passportId })
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to load ABC logs:", error);
          setLoadError("Couldn't load ABC logs.");
          setIsLoading(false);
          return;
        }
        setLogs(
          ((data ?? []) as RawAbcLogRow[]).map((row) => ({
            id: row.id,
            incidentDate: row.incident_date,
            incidentTime: row.incident_time,
            loggedByName: row.logged_by_name ?? "Someone",
            loggedByRole: row.logged_by_role,
            durationMinutes: row.duration_minutes,
            intensity: row.intensity,
            antecedents: row.antecedents ?? [],
            antecedentOther: row.antecedent_other,
            behaviours: row.behaviours ?? [],
            behaviourOther: row.behaviour_other,
            consequences: row.consequences ?? [],
            consequenceOther: row.consequence_other,
            sensorySought: row.sensory_sought ?? [],
            sensoryAvoided: row.sensory_avoided ?? [],
            sensorySoughtOther: row.sensory_sought_other,
            sensoryAvoidedOther: row.sensory_avoided_other,
            perceivedFunction: row.perceived_function,
            perceivedFunctionOther: row.perceived_function_other,
            generalNotes: row.general_notes,
          }))
        );
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [passportId, reloadKey]);

  return { logs, isLoading, loadError, refresh: () => setReloadKey((k) => k + 1) };
}
