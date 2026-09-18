"use client";

import { useParams, useRouter } from "next/navigation";
import { SessionNoteEditor } from "@/components/clinician/session-notes/SessionNoteEditor";

// Thin route shell, same shape as fba/[fbaId]/section/[sectionId]/
// page.tsx -- real router.push navigation, all fetching and save
// mechanics live in SessionNoteEditor.
export default function SessionNoteEditorPage() {
  const { passportId, noteId } = useParams<{ passportId: string; noteId: string }>();
  const router = useRouter();

  return (
    <SessionNoteEditor
      noteId={noteId}
      onNavigateBack={() => router.push(`/clinician/passport/${passportId}?tab=sessionNotes`)}
    />
  );
}
