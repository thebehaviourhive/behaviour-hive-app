"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";

// PRD 6 Stage 2 -- the writing surface's own save hook. Mirrors
// useFbaReport's shape (load/saveStatus/saveError), but session_notes
// has three independently-saveable COLUMNS (session_date,
// clinical_record, parent_note), not one JSON blob -- so saveField()
// sends a targeted partial patch, matching AFLS's own per-field pattern
// (useAflsAssessmentsForFba.updateAssessment) rather than FBA's
// whole-blob rewrite.
//
// A QUEUE, not abort-and-restart. FBA's own triggerSave() aborts an
// in-flight save and starts a fresh one, because content_data is a
// single blob rebuilt on every edit -- a stale in-flight save could
// otherwise clobber a newer one. Here, each save targets only the
// column that changed, so two saves in flight for DIFFERENT fields
// (clinical_record and parent_note) are never in conflict, and two
// saves for the SAME field just need to apply in order -- a plain
// chained queue (AFLS's own saveQueueRef shape) gives that for free,
// with none of the abort-controller bookkeeping FBA's own blob-rewrite
// approach actually needs.
export type SaveStatus = "idle" | "saving" | "waiting-for-connection" | "saved" | "error";

export interface SessionNote {
  id: string;
  passportId: string;
  clinicianId: string;
  sessionDate: string; // yyyy-mm-dd
  clinicalRecord: string;
  parentNote: string;
  isSharedWithParent: boolean;
  sharedAt: string | null;
  parentNoteEditedAfterShareAt: string | null;
  parentNoteEditedAfterShareBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionNoteRow {
  id: string;
  passport_id: string;
  clinician_id: string;
  session_date: string;
  clinical_record: string | null;
  parent_note: string | null;
  is_shared_with_parent: boolean;
  shared_at: string | null;
  parent_note_edited_after_share_at: string | null;
  parent_note_edited_after_share_by: string | null;
  created_at: string;
  updated_at: string;
}

function mapNote(row: SessionNoteRow): SessionNote {
  return {
    id: row.id,
    passportId: row.passport_id,
    clinicianId: row.clinician_id,
    sessionDate: row.session_date,
    clinicalRecord: row.clinical_record ?? "",
    parentNote: row.parent_note ?? "",
    isSharedWithParent: row.is_shared_with_parent,
    sharedAt: row.shared_at,
    parentNoteEditedAfterShareAt: row.parent_note_edited_after_share_at,
    parentNoteEditedAfterShareBy: row.parent_note_edited_after_share_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type SessionNoteFieldPatch = Partial<Pick<SessionNote, "sessionDate" | "clinicalRecord" | "parentNote">>;

export function useSessionNote(noteId: string) {
  const [note, setNote] = useState<SessionNote | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<"saved" | "cancelled" | "error">>(Promise.resolve("saved"));

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.from("session_notes").select("*").eq("id", noteId).maybeSingle();

    if (error) {
      console.error("Failed to load session note:", error);
      setLoadError("Couldn't load this session note.");
      setIsLoading(false);
      return;
    }

    setNote(data ? mapNote(data as SessionNoteRow) : null);
    setIsLoading(false);
  }, [noteId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const saveField = useCallback(
    (patch: SessionNoteFieldPatch, signal?: AbortSignal): Promise<"saved" | "cancelled" | "error"> => {
      const dbPatch: Record<string, unknown> = {};
      if ("sessionDate" in patch) dbPatch.session_date = patch.sessionDate;
      if ("clinicalRecord" in patch) dbPatch.clinical_record = patch.clinicalRecord;
      if ("parentNote" in patch) dbPatch.parent_note = patch.parentNote;

      const run = async (): Promise<"saved" | "cancelled" | "error"> => {
        setSaveError(null);
        const supabase = createClient();
        const result = await insertWithOfflineRetry(
          () => supabase.from("session_notes").update(dbPatch).eq("id", noteId),
          setSaveStatus,
          signal
        );

        if (result === "cancelled") {
          setSaveStatus("idle");
          return "cancelled";
        }
        if (result) {
          setSaveStatus("error");
          setSaveError(result);
          return "error";
        }

        setNote((prev) => (prev ? { ...prev, ...patch } : prev));
        setSaveStatus("saved");
        return "saved";
      };

      const next = saveQueueRef.current.then(run);
      saveQueueRef.current = next;
      return next;
    },
    [noteId]
  );

  // Sharing is a real, deliberate write -- not part of saveField()'s own
  // queue, and not something a blur ever triggers. This is the ONLY
  // place is_shared_with_parent is ever set (client-side); the DB
  // trigger (0228's own _session_note_share_tracking) does the rest --
  // sets shared_at, fires the activity_log pointer. Re-fetches
  // afterward rather than guessing the trigger's own writes locally.
  const share = useCallback(async (): Promise<{ error: string | null }> => {
    const supabase = createClient();
    const { error } = await supabase
      .from("session_notes")
      .update({ is_shared_with_parent: true })
      .eq("id", noteId);
    if (error) return { error: error.message };
    await load();
    return { error: null };
  }, [noteId, load]);

  return { note, isLoading, loadError, reload: load, saveField, saveStatus, saveError, share };
}
