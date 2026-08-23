import type { ABCLoggerRole } from "./roleConfig";

// One draft slot per passport per device. Continuously autosaved while
// the logger is open (see ABCLogger), so "resume where I left off" works
// for any interruption, not just the network-failure case -- and also
// doubles as that network-failure fallback: on a failed submit the same
// draft is written back with isDraft/syncStatus flipped, matching the
// abc_logs row shape those two columns describe, before the "saved
// locally" message is shown.
export interface ABCDraft {
  role: ABCLoggerRole;
  step: number;
  incidentDate: string;
  incidentTime: string;
  durationMinutes: string;
  intensity: number | null;
  antecedents: string[];
  antecedentOther: string;
  behaviours: string[];
  behaviourOther: string;
  consequences: string[];
  consequenceOther: string;
  sensorySought: string[];
  sensorySoughtOther: string;
  sensoryAvoided: string[];
  sensoryAvoidedOther: string;
  generalNotes: string;
  perceivedFunction: string | null;
  perceivedFunctionOther: string;
  isDraft: boolean;
  syncStatus: "pending" | "synced";
  savedAt: string;
}

function draftKey(passportId: string): string {
  return `abcLogDraft:${passportId}`;
}

export function loadDraft(passportId: string): ABCDraft | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(draftKey(passportId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ABCDraft;
  } catch {
    return null;
  }
}

export function saveDraft(passportId: string, draft: ABCDraft): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(draftKey(passportId), JSON.stringify(draft));
}

export function clearDraft(passportId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(draftKey(passportId));
}
