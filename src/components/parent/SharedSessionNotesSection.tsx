"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// PRD 6 Stage 3 -- the parent's own read. Self-contained and self-
// fetching, same shape as ClinicalSupportSection: mounted directly on
// passport/dashboard (the full record), not parent-dashboard (the
// inbox) -- a growing list of session notes over time is record
// material, the same category "Clinical Team"/"ABC Logs" already sit
// in on this page, not something-new-just-happened inbox material.
// The inbox-side signal is the activity_log pointer alone (see
// activityEvents.tsx's own session_note_shared/session_note_updated
// entries) -- "the feed says something arrived, the passport is where
// you read it", the identical shape clinical_content_added already
// established; this section is the "where you read it" half.
//
// get_shared_session_notes() structurally never returns clinical_record
// -- there is nothing to accidentally render here even by mistake, the
// column simply isn't in the row shape.
interface SharedSessionNote {
  id: string;
  sessionDate: string;
  parentNote: string;
  sharedAt: string;
  parentNoteEditedAfterShareAt: string | null;
  clinicianName: string | null;
}

interface SharedSessionNoteRow {
  id: string;
  session_date: string;
  parent_note: string | null;
  shared_at: string;
  parent_note_edited_after_share_at: string | null;
  clinician_name: string | null;
}

export function SharedSessionNotesSection({ passportId }: { passportId: string }) {
  const [notes, setNotes] = useState<SharedSessionNote[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_shared_session_notes", { p_passport_id: passportId });

    if (error) {
      console.error("Failed to load shared session notes:", error);
      setLoadError("Couldn't load session notes.");
      setNotes(null);
      return;
    }

    setNotes(
      (data as SharedSessionNoteRow[]).map((row) => ({
        id: row.id,
        sessionDate: row.session_date,
        parentNote: row.parent_note ?? "",
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

  return (
    <section className="rounded-2xl border border-brand-off-white/50 bg-white p-5 shadow-[0_4px_20px_rgba(0,79,113,0.05)]">
      <h2 className="mb-4 font-heading text-lg font-bold text-brand-prussian-blue">Session Notes</h2>

      {notes === null ? (
        loadError ? (
          <InlineErrorState message={loadError} onRetry={load} />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-xl bg-brand-off-white/50" />
            <div className="h-16 animate-pulse rounded-xl bg-brand-off-white/50" />
          </div>
        )
      ) : notes.length === 0 ? (
        <p className="text-center text-sm text-brand-neutral-black/60">
          No session notes have been shared with you yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((note) => (
            <SessionNoteCard key={note.id} note={note} />
          ))}
        </div>
      )}
    </section>
  );
}

function SessionNoteCard({ note }: { note: SharedSessionNote }) {
  // THE EDIT-AFTER-SHARE MARKER -- the whole reason this column exists.
  // A parent who read this note on Tuesday and comes back after an edit
  // must be able to tell it changed, on the note ITSELF, not from a
  // feed entry that's already scrolled away. Two signals, not one --
  // colour is never the only differentiator anywhere else in this
  // product (see the badge-colour entry this codebase already has),
  // and a border accent alone is easy to miss on a re-visit: the
  // golden-brown left border (this codebase's own established "flags
  // something for attention" convention) PLUS an explicit, dated line
  // of text.
  const wasEditedAfterShare = !!note.parentNoteEditedAfterShareAt;

  return (
    <div
      className={`rounded-2xl border bg-white p-4 shadow-sm ${
        wasEditedAfterShare ? "border-l-4 border-brand-golden-brown" : "border-black/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-brand-neutral-black">{formatSessionDate(note.sessionDate)}</p>
        {wasEditedAfterShare && (
          <span className="flex-shrink-0 rounded-full bg-brand-golden-brown/15 px-2.5 py-0.5 text-xs font-semibold text-brand-golden-brown">
            Updated {formatSessionDate(note.parentNoteEditedAfterShareAt as string)}
          </span>
        )}
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-brand-neutral-black/80">{note.parentNote}</p>
      <p className="mt-2 text-xs text-brand-neutral-black/40">
        From {note.clinicianName ?? "your clinical team"} · Shared {formatSessionDate(note.sharedAt)}
      </p>
    </div>
  );
}

function formatSessionDate(isoOrDateOnly: string): string {
  // Handles both a plain "yyyy-mm-dd" date column (session_date) and a
  // full timestamptz (shared_at, parent_note_edited_after_share_at) --
  // a bare date string has no timezone to misinterpret, so only the
  // date-only case needs the local-parse discipline this codebase's
  // other date formatters already use.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDateOnly)
    ? (() => {
        const [year, month, day] = isoOrDateOnly.split("-").map(Number);
        return new Date(year, month - 1, day);
      })()
    : new Date(isoOrDateOnly);
  return date.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}
