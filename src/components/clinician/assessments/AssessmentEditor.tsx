"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { AssessmentResponseSheetEditor } from "@/components/clinician/assessments/AssessmentResponseSheetEditor";
import { AssessmentExternalRecordEditor } from "@/components/clinician/assessments/AssessmentExternalRecordEditor";
import type { AssessmentRecordType } from "@/hooks/useAssessmentInstruments";

// Thin router: a single cheap select for record_type alone decides
// which editor to mount -- each editor is self-contained and does its
// own full useAssessment() fetch, same "route is a shell, the editor
// self-fetches" shape as SessionNoteEditor. Never receives a
// built_in_full record_type -- no assessments row can have one (see
// the migration's own _assessments_set_record_type() guard).
export function AssessmentEditor({ assessmentId, passportId }: { assessmentId: string; passportId: string }) {
  const [recordType, setRecordType] = useState<AssessmentRecordType | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setRecordType(undefined);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("assessments")
      .select("record_type")
      .eq("id", assessmentId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load assessment:", error);
      setLoadError("Couldn't load this assessment.");
      setRecordType(null);
      return;
    }
    setRecordType(data?.record_type ?? null);
  }, [assessmentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (recordType === undefined) {
    return (
      <div className="flex flex-col gap-3 px-4 pt-4">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="px-4 pt-4">
        <InlineErrorState message={loadError} onRetry={load} />
      </div>
    );
  }

  if (!recordType) {
    return (
      <div className="px-4 pt-4">
        <InlineErrorState message="This assessment couldn't be found." onRetry={load} />
      </div>
    );
  }

  if (recordType === "response_sheet") {
    return <AssessmentResponseSheetEditor assessmentId={assessmentId} passportId={passportId} />;
  }

  return <AssessmentExternalRecordEditor assessmentId={assessmentId} passportId={passportId} />;
}
