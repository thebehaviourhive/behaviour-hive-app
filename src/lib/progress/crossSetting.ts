import { buildDateBuckets, entriesInRange, type AbcTrendEntry } from "./abc";
import type { DayEntry } from "./regulation";
import type { DateRange } from "./range";

// STAGE C, CLINICIAN LENS ONLY. Reuses the exact same bucket boundaries
// as the ABC frequency chart (buildDateBuckets) so morning/afternoon
// settled-rate and incident count line up against one shared timeline --
// "does home predict school", presented factually (rates and counts
// side by side, never phrased as a causal claim; the caller owns any
// copy around this data, this module only computes it).
export interface CrossSettingBucket {
  label: string;
  start: string;
  end: string;
  morningSettledRate: number | null; // 0-100, null when no morning data in this bucket
  morningDataDays: number;
  afternoonSettledRate: number | null;
  afternoonDataDays: number;
  incidentCount: number;
}

function settledRate(entries: DayEntry[], start: string, end: string): { rate: number | null; dataDays: number } {
  const inRange = entries.filter((e) => e.date >= start && e.date <= end && e.state);
  if (inRange.length === 0) return { rate: null, dataDays: 0 };
  const settled = inRange.filter((e) => e.state === "settled").length;
  return { rate: Math.round((settled / inRange.length) * 100), dataDays: inRange.length };
}

export function buildCrossSettingBuckets(
  morningEntries: DayEntry[],
  afternoonEntries: DayEntry[],
  abcEntries: AbcTrendEntry[],
  range: DateRange
): CrossSettingBucket[] {
  const dateBuckets = buildDateBuckets(range);
  return dateBuckets.map((b) => {
    const morning = settledRate(morningEntries, b.start, b.end);
    const afternoon = settledRate(afternoonEntries, b.start, b.end);
    const incidentCount = entriesInRange(abcEntries, { start: b.start, end: b.end }).length;
    return {
      label: b.label,
      start: b.start,
      end: b.end,
      morningSettledRate: morning.rate,
      morningDataDays: morning.dataDays,
      afternoonSettledRate: afternoon.rate,
      afternoonDataDays: afternoon.dataDays,
      incidentCount,
    };
  });
}
