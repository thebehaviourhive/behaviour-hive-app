"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface AbcFunctionEntry {
  id: string;
  incidentDate: string;
  perceivedFunction: string | null;
}

interface RawAbcLogRow {
  id: string;
  incident_date: string;
  perceived_function: string | null;
}

// CLINICIAN-ONLY. Reads through the existing get_abc_logs() RPC (migration
// 0029), already gated to verified, actively-linked clinicians for the
// perceived_function column -- this hook must never be imported from a
// parent- or teacher-reachable file (see the adversarial grep check in
// the Stage B verify pass). The parent/teacher frequency and categorical
// charts read through useAbcTrendData instead, which cannot return this
// field even if a caller wanted it to.
export function useAbcFunctionData(passportId: string) {
  const [entries, setEntries] = useState<AbcFunctionEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
          console.error("Failed to load ABC function data:", error);
          setLoadError("Couldn't load incident data.");
          setIsLoading(false);
          return;
        }
        setEntries(
          ((data ?? []) as RawAbcLogRow[]).map((row) => ({
            id: row.id,
            incidentDate: row.incident_date,
            perceivedFunction: row.perceived_function,
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
