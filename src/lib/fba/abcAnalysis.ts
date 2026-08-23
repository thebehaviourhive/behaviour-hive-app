import { ABC_FUNCTION_LABELS, ABC_FUNCTION_OPTIONS, type AbcHypothesisedFunction } from "./types";

export interface AbcLogSummary {
  id: string;
  incidentDate: string;
  incidentTime: string;
  loggedByName: string;
  loggedByRole: string;
  durationMinutes: number | null;
  intensity: number;
  antecedents: string[];
  antecedentOther: string | null;
  behaviours: string[];
  behaviourOther: string | null;
  consequences: string[];
  consequenceOther: string | null;
  sensorySought: string[];
  sensoryAvoided: string[];
  sensorySoughtOther: string | null;
  sensoryAvoidedOther: string | null;
  perceivedFunction: string | null;
  perceivedFunctionOther: string | null;
  generalNotes: string | null;
}

// Bars for all six hypothesised functions, scaled against the largest
// bucket so relative heights are meaningful -- Untagged incidents are
// deliberately excluded from this chart (it counts tagged functions,
// not "all incidents").
export function countByFunction(
  logs: AbcLogSummary[],
  tags: Record<string, AbcHypothesisedFunction>
): { label: string; value: number; max: number }[] {
  const counts = ABC_FUNCTION_OPTIONS.reduce(
    (acc, fn) => ({ ...acc, [fn]: 0 }),
    {} as Record<AbcHypothesisedFunction, number>
  );
  for (const log of logs) {
    const tag = tags[log.id];
    if (tag) counts[tag] += 1;
  }
  const max = Math.max(1, ...Object.values(counts));
  return ABC_FUNCTION_OPTIONS.map((fn) => ({ label: ABC_FUNCTION_LABELS[fn], value: counts[fn], max }));
}

// Tallies the real categorical values already present in abc_logs
// (antecedents/consequences are text[] against a fixed per-role option
// set -- see roleConfig.ts) -- never invented buckets, and "Other" is
// its own single slice rather than expanding every free-text
// antecedent_other value into its own fragment.
function tallyCategorical(values: string[][]): { label: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const arr of values) {
    for (const value of arr) {
      tally.set(value, (tally.get(value) ?? 0) + 1);
    }
  }
  return Array.from(tally.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function tallyAntecedents(logs: AbcLogSummary[]): { label: string; count: number }[] {
  return tallyCategorical(logs.map((l) => l.antecedents));
}

export function tallyBehaviours(logs: AbcLogSummary[]): { label: string; count: number }[] {
  return tallyCategorical(logs.map((l) => l.behaviours));
}

export function tallyConsequences(logs: AbcLogSummary[]): { label: string; count: number }[] {
  return tallyCategorical(logs.map((l) => l.consequences));
}
