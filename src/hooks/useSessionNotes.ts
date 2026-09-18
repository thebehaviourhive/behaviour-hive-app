"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// The Clinical File's Session Notes tab list. No client-side "mine
// only" filter is needed -- session_notes' own SELECT policy already
// scopes a clinician's own query to their own notes (clinician_id =
// auth.uid()); a director's own read is a separate branch this
// component never exercises. Reading the notes of colleagues who also
// worked with this client is PRD 6 section 7's own Stage 4 (reading),
// not this stage.
export interface SessionNoteSummary {
  id: string;
  sessionDate: string;
  clinicalRecordPreview: string;
  isSharedWithParent: boolean;
}

interface SessionNoteSummaryRow {
  id: string;
  session_date: string;
  clinical_record: string | null;
  is_shared_with_parent: boolean;
}

export function useSessionNotes(passportId: string) {
  const [notes, setNotes] = useState<SessionNoteSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("session_notes")
      .select("id, session_date, clinical_record, is_shared_with_parent")
      .eq("passport_id", passportId)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load session notes:", error);
      setLoadError("Couldn't load session notes.");
      setNotes(null);
      return;
    }

    setNotes(
      (data as SessionNoteSummaryRow[]).map((row) => ({
        id: row.id,
        sessionDate: row.session_date,
        clinicalRecordPreview: row.clinical_record ?? "",
        isSharedWithParent: row.is_shared_with_parent,
      }))
    );
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { notes, loadError, reload: load };
}
