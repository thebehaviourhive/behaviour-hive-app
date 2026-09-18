"use client";

import { useParams } from "next/navigation";
import { AssessmentEditor } from "@/components/clinician/assessments/AssessmentEditor";

// Thin route shell, same shape as session-note/[noteId]/page.tsx --
// AssessmentEditor decides which of the two editors to mount and does
// its own fetching/save mechanics.
export default function AssessmentEditorPage() {
  const { passportId, assessmentId } = useParams<{ passportId: string; assessmentId: string }>();

  return <AssessmentEditor assessmentId={assessmentId} passportId={passportId} />;
}
