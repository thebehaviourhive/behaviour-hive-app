"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AssessmentRecordType } from "@/hooks/useAssessmentInstruments";

// The Clinical File's Assessments tab list. No client-side "mine only"
// filter needed -- assessments' own SELECT policy already scopes a
// clinician's query to their own records (clinician_id = auth.uid()),
// same shape as useSessionNotes.ts. Never includes FBA -- an FBA never
// gets a row in this table at all (assessments_set_record_type()
// refuses a built_in_full instrument outright), so there's nothing
// here to filter out.
export interface AssessmentSummary {
  id: string;
  instrumentName: string;
  recordType: AssessmentRecordType;
  assessmentDate: string;
  completedAt: string | null;
}

interface AssessmentSummaryRow {
  id: string;
  record_type: AssessmentRecordType;
  assessment_date: string;
  completed_at: string | null;
  assessment_instruments: { name: string } | null;
}

export function useAssessments(passportId: string) {
  const [assessments, setAssessments] = useState<AssessmentSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("assessments")
      .select("id, record_type, assessment_date, completed_at, assessment_instruments(name)")
      .eq("passport_id", passportId)
      .order("assessment_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load assessments:", error);
      setLoadError("Couldn't load assessments.");
      setAssessments(null);
      return;
    }

    setAssessments(
      (data as unknown as AssessmentSummaryRow[]).map((row) => ({
        id: row.id,
        instrumentName: row.assessment_instruments?.name ?? "Unknown instrument",
        recordType: row.record_type,
        assessmentDate: row.assessment_date,
        completedAt: row.completed_at,
      }))
    );
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { assessments, loadError, reload: load };
}
