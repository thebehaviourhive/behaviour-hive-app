"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// PRD 7 Stage 1 -- the instrument catalogue. Global, not per-institution
// (assessment_instruments' own SELECT policy is `using (true)`), so no
// institutionId is needed here. Active instruments only -- is_active
// gives Behaviour Hive a way to retire an entry later without deleting
// history that already references it (matching every other Behaviour-
// Hive-controlled vocabulary table's own convention).
export type AssessmentRecordType = "response_sheet" | "external_record" | "built_in_full";

export interface AssessmentInstrument {
  id: string;
  name: string;
  recordType: AssessmentRecordType;
  itemCount: number | null;
  responseScale: string[] | null;
}

interface AssessmentInstrumentRow {
  id: string;
  name: string;
  record_type: AssessmentRecordType;
  item_count: number | null;
  response_scale: string[] | null;
}

export function useAssessmentInstruments() {
  const [instruments, setInstruments] = useState<AssessmentInstrument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("assessment_instruments")
      .select("id, name, record_type, item_count, response_scale")
      .eq("is_active", true)
      .order("name");

    if (error) {
      console.error("Failed to load the assessment catalogue:", error);
      setLoadError("Couldn't load the assessment catalogue.");
      setInstruments(null);
      return;
    }

    setInstruments(
      (data as AssessmentInstrumentRow[]).map((row) => ({
        id: row.id,
        name: row.name,
        recordType: row.record_type,
        itemCount: row.item_count,
        responseScale: row.response_scale,
      }))
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { instruments, loadError, reload: load };
}
