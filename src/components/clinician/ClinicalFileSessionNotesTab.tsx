"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useSessionNotes } from "@/hooks/useSessionNotes";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// PRD 6 Stage 2 -- the Clinical File's own Session Notes tab. "+ New
// Session Note" inserts a bare row immediately (session_date = today,
// both text fields empty) and navigates straight into the editor for
// it -- the row's own existence is what makes "started during, finished
// after" work with no separate draft state: closing the tab and
// reopening this note later just means the row is still there, however
// little was saved before they left.
export function ClinicalFileSessionNotesTab({
  passportId,
  clinicianId,
}: {
  passportId: string;
  clinicianId: string;
}) {
  const router = useRouter();
  const { notes, loadError, reload } = useSessionNotes(passportId);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleNewNote() {
    setIsCreating(true);
    setCreateError(null);
    const supabase = createClient();
    const today = new Date();
    const sessionDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;

    const { data, error } = await supabase
      .from("session_notes")
      .insert({ passport_id: passportId, clinician_id: clinicianId, session_date: sessionDate })
      .select("id")
      .single();

    if (error || !data) {
      console.error("Failed to start a session note:", error);
      setCreateError("Couldn't start a new session note.");
      setIsCreating(false);
      return;
    }

    router.push(`/clinician/passport/${passportId}/session-note/${data.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={handleNewNote}
        disabled={isCreating}
        className="w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 lg:w-auto lg:px-6"
      >
        {isCreating ? "Starting…" : "+ New Session Note"}
      </button>

      {createError && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {createError}
        </p>
      )}

      {notes === null ? (
        loadError ? (
          <InlineErrorState message={loadError} onRetry={reload} />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="h-20 animate-pulse rounded-2xl bg-white" />
            <div className="h-20 animate-pulse rounded-2xl bg-white" />
          </div>
        )
      ) : notes.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
          <p className="text-sm text-brand-neutral-black/70">No session notes for this child yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => router.push(`/clinician/passport/${passportId}/session-note/${note.id}`)}
              className="rounded-2xl border border-black/5 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-brand-pastel-blue"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-brand-neutral-black">{formatSessionDate(note.sessionDate)}</p>
                {note.isSharedWithParent && (
                  <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-0.5 text-xs font-semibold text-brand-prussian-blue">
                    Shared
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-sm text-brand-neutral-black/60">
                {note.clinicalRecordPreview.trim() || "No clinical record written yet."}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSessionDate(sessionDate: string): string {
  // session_date is a plain "yyyy-mm-dd" date column -- parsed as
  // local, not via `new Date("yyyy-mm-dd")` directly (which JS treats
  // as UTC midnight and can render as the PREVIOUS day in any timezone
  // west of UTC). Same discipline AFLS's own formatAssessmentDate uses.
  const [year, month, day] = sessionDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
}
