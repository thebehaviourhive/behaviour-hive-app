// The principal's incidents list needs a four-state "where does this
// stand" summary, distinct from the raw incidents.status enum
// (draft/awaiting_signoff/awaiting_principal/finalised) -- draft and
// awaiting_signoff both split further into MISSING INFO or IN
// PROGRESS depending on whether anything is actually outstanding.
//
// has_blocking_issues (migration 0150) reuses incident_signoff_issues()
// -- the SAME function the sign-off summary and the database's own
// guard triggers already use -- rather than a second definition of
// "what's outstanding" computed here. This file only combines that one
// signal with the two timestamps that already define the other states.
//
// No semantic red/amber/green anywhere in this app -- Golden Brown for
// the two states that need someone (Awaiting Countersign, Missing
// Info), Prussian Blue for In Progress (an active draft, not a
// problem), muted neutral for Finished (a closed record should
// recede). Colour is never the only signal -- every state also carries
// its label in words, everywhere this is rendered.

export type IncidentDisplayStatus = "finished" | "awaiting_countersign" | "missing_info" | "in_progress";

export interface IncidentStatusInput {
  teacher_signed_at: string | null;
  countersigned_at: string | null;
  has_blocking_issues: boolean;
}

export function deriveIncidentDisplayStatus(row: IncidentStatusInput): IncidentDisplayStatus {
  if (row.countersigned_at) return "finished";
  if (row.teacher_signed_at) return "awaiting_countersign";
  if (row.has_blocking_issues) return "missing_info";
  return "in_progress";
}

export const INCIDENT_DISPLAY_STATUS_LABEL: Record<IncidentDisplayStatus, string> = {
  finished: "Finished",
  awaiting_countersign: "Awaiting Countersign",
  missing_info: "Missing Info",
  in_progress: "In Progress",
};

// Golden Brown is shared by two states -- distinguishable by the label
// text, always rendered alongside, never colour alone.
export const INCIDENT_DISPLAY_STATUS_STYLE: Record<IncidentDisplayStatus, string> = {
  finished: "bg-brand-off-white text-brand-neutral-black/60",
  awaiting_countersign: "border border-brand-golden-brown/30 bg-brand-golden-brown/10 text-brand-golden-brown",
  missing_info: "border border-brand-golden-brown/30 bg-brand-golden-brown/10 text-brand-golden-brown",
  in_progress: "bg-brand-pastel-blue/20 text-brand-prussian-blue",
};
