import { PERCEIVED_FUNCTION_OPTIONS } from "@/components/abc-logger/roleConfig";
import type { DateRange } from "./range";

// CLINICIAN-ONLY pure logic -- tallies abc_logs.perceived_function (the
// reporter's own optional function tag, set at logging time by a teacher
// or clinician; parents aren't asked, see roleConfig.ts's per-role
// step4Extra). Kept in its own module, separate from abc.ts, so "does
// this file reference function-tag data at all" is a one-glance grep
// during the adversarial verify pass, rather than mixed into the shared
// frequency/categorical logic every role's charts also use.
//
// Untagged incidents are deliberately excluded from the tally (it counts
// tagged functions, not "all incidents") -- same posture as fba/
// abcAnalysis.ts's countByFunction, which tallies the FBA's own
// clinician-assigned function tags rather than this per-incident field;
// the two are intentionally different data sources (a standing per-
// incident attribute here vs. a specific FBA report's analysis there),
// so this module doesn't reuse or reference that one.
export interface FunctionEntry {
  id: string;
  incidentDate: string;
  perceivedFunction: string | null;
}

export interface FunctionTally {
  label: string;
  value: number;
  max: number;
}

const FUNCTION_LABELS: Record<string, string> = Object.fromEntries(
  PERCEIVED_FUNCTION_OPTIONS.map((o) => [o.value, o.label])
);

export function tallyByFunction(entries: FunctionEntry[], range: DateRange): FunctionTally[] {
  const inRange = entries.filter((e) => e.incidentDate >= range.start && e.incidentDate <= range.end);
  const counts: Record<string, number> = Object.fromEntries(PERCEIVED_FUNCTION_OPTIONS.map((o) => [o.value, 0]));
  for (const entry of inRange) {
    if (entry.perceivedFunction && entry.perceivedFunction in counts) {
      counts[entry.perceivedFunction] += 1;
    }
  }
  const max = Math.max(1, ...Object.values(counts));
  return PERCEIVED_FUNCTION_OPTIONS.map((o) => ({ label: FUNCTION_LABELS[o.value], value: counts[o.value], max }));
}

export function taggedIncidentCount(entries: FunctionEntry[], range: DateRange): number {
  return entries.filter(
    (e) => e.incidentDate >= range.start && e.incidentDate <= range.end && e.perceivedFunction
  ).length;
}
