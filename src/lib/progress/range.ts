import { addDays, daysBetweenInclusive, todayLocalDateString } from "./dateUtils";

// Stage A's four presets, plus Stage C's "custom" -- clinician lens
// only, mirroring the FBA assessment-window pattern (DirectAssessmentSection's
// abcRangeStart/abcRangeEnd: two plain <input type="date"> fields, no
// cross-field validation beyond "both must be set"). Parent/teacher
// RangeSelector never renders a "Custom" pill, so this key is simply
// unreachable for those roles rather than needing a runtime guard here.
export type ProgressRangeKey = "7" | "30" | "90" | "all" | "custom";

export const PROGRESS_RANGE_OPTIONS: { key: ProgressRangeKey; label: string }[] = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
];

export interface DateRange {
  start: string;
  end: string;
}

// earliestDataDate is the earliest date with ANY check-in/update row for
// this passport -- "all time" starts there, not at some arbitrary fixed
// horizon. When there's genuinely no data yet, start collapses to today
// (a real but zero-length range), which every consumer downstream
// already treats as "empty", not as an error case.
//
// customRange is only consulted when rangeKey === "custom" -- same
// "no start.length > end enforcement" posture as the FBA assessment
// window this mirrors: an inverted range just yields daysBetweenInclusive
// <= 0 downstream (previousRange already guards on that), never a crash.
export function resolveRange(
  rangeKey: ProgressRangeKey,
  earliestDataDate: string | null,
  today: string = todayLocalDateString(),
  customRange?: DateRange | null
): DateRange {
  if (rangeKey === "custom") {
    return customRange ?? { start: today, end: today };
  }
  if (rangeKey === "all") {
    return { start: earliestDataDate ?? today, end: today };
  }
  const days = Number(rangeKey);
  return { start: addDays(today, -(days - 1)), end: today };
}

// The immediately-preceding, same-length window -- constraint 6's
// "comparisons are same-length (selected range vs the previous equal
// range)". Deliberately undefined for "all time": there's no larger
// prior period to compare an all-time range against, so callers must
// treat a null return as "no comparison possible" rather than fabricate
// one.
export function previousRange(range: DateRange): DateRange | null {
  const length = daysBetweenInclusive(range.start, range.end);
  if (length <= 0) return null;
  const end = addDays(range.start, -1);
  const start = addDays(end, -(length - 1));
  return { start, end };
}

// Constraint 6's honesty rule: >=4 data days per 7-day period, scaled
// proportionally. Rounds up so a partial week never rounds down to a
// weaker bar than the stated "4 per 7" rate.
export function densityThreshold(periodLengthDays: number): number {
  return Math.max(1, Math.ceil((4 * periodLengthDays) / 7));
}

export function meetsThreshold(dataDayCount: number, periodLengthDays: number): boolean {
  return dataDayCount >= densityThreshold(periodLengthDays);
}
