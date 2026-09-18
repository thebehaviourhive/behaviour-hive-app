"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// PRD 6 Stage 4 -- the clinic director's own read. Read-only: no write
// policy on session_notes has ever granted a director anything (see
// migration 0228's own SELECT-policy comment, "A DIRECTOR READS, NEVER
// EDITS", stated in the policy itself, not left to infer). Total, not
// redacted -- unlike SharedSessionNotesSection (the parent's own read),
// a director sees clinical_record too; there is no boundary between a
// director and their own clinic's clinical record the way there
// structurally is for a parent.
//
// get_session_notes_for_director() already returns nothing for a
// SCHOOL principal (its own director check requires inst.type =
// 'clinic') -- ChildDetail.tsx only renders this tab at all when
// institutionType === "clinic", so a school principal never sees an
// empty "Session Notes" tab that means nothing to them.
interface DirectorSessionNote {
  id: string;
  sessionDate: string;
  clinicalRecord: string;
  parentNote: string;
  isSharedWithParent: boolean;
  sharedAt: string | null;
  parentNoteEditedAfterShareAt: string | null;
  clinicianName: string | null;
}

interface DirectorSessionNoteRow {
  id: string;
  session_date: string;
  clinical_record: string | null;
  parent_note: string | null;
  is_shared_with_parent: boolean;
  shared_at: string | null;
  parent_note_edited_after_share_at: string | null;
  clinician_name: string | null;
}

export function DirectorSessionNotesTab({ passportId }: { passportId: string }) {
  const [notes, setNotes] = useState<DirectorSessionNote[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_session_notes_for_director", { p_passport_id: passportId });

    if (error) {
      console.error("Failed to load session notes:", error);
      setLoadError("Couldn't load session notes.");
      setNotes(null);
      return;
    }

    setNotes(
      (data as DirectorSessionNoteRow[]).map((row) => ({
        id: row.id,
        sessionDate: row.session_date,
        clinicalRecord: row.clinical_record ?? "",
        parentNote: row.parent_note ?? "",
        isSharedWithParent: row.is_shared_with_parent,
        sharedAt: row.shared_at,
        parentNoteEditedAfterShareAt: row.parent_note_edited_after_share_at,
        clinicianName: row.clinician_name,
      }))
    );
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (notes === null) {
    return loadError ? (
      <InlineErrorState message={loadError} onRetry={load} />
    ) : (
      <div className="flex flex-col gap-2">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
        <p className="text-sm text-brand-neutral-black/70">No session notes for this client yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {notes.map((note) => (
        <DirectorSessionNoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}

function DirectorSessionNoteCard({ note }: { note: DirectorSessionNote }) {
  const wasEditedAfterShare = !!note.parentNoteEditedAfterShareAt;

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-brand-neutral-black">{formatSessionDate(note.sessionDate)}</p>
        {note.isSharedWithParent && (
          <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-0.5 text-xs font-semibold text-brand-prussian-blue">
            Shared with parent
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-brand-neutral-black/50">By {note.clinicianName ?? "an unnamed clinician"}</p>

      <div className="mt-3">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">Clinical Record</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-brand-neutral-black/80">
          {note.clinicalRecord.trim() || "No clinical record written yet."}
        </p>
      </div>

      {note.parentNote.trim() && (
        <div
          className={`mt-3 rounded-xl border-l-4 p-3 ${
            wasEditedAfterShare ? "border-brand-golden-brown bg-brand-golden-brown/5" : "border-brand-pastel-blue bg-brand-pastel-blue/10"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">Parent Note</p>
            {wasEditedAfterShare && (
              <span className="flex-shrink-0 rounded-full bg-brand-golden-brown/15 px-2 py-0.5 text-xs font-semibold text-brand-golden-brown">
                Updated {formatSessionDate(note.parentNoteEditedAfterShareAt as string)}
              </span>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-brand-neutral-black/80">{note.parentNote}</p>
        </div>
      )}
    </div>
  );
}

function formatSessionDate(isoOrDateOnly: string): string {
  // Same local-parse discipline as SharedSessionNotesSection -- a bare
  // "yyyy-mm-dd" date column has no timezone to misinterpret, so only
  // the date-only case needs the split/local-construct path.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDateOnly)
    ? (() => {
        const [year, month, day] = isoOrDateOnly.split("-").map(Number);
        return new Date(year, month - 1, day);
      })()
    : new Date(isoOrDateOnly);
  return date.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}
