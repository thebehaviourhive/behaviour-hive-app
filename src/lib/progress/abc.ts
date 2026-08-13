import { addDays, daysBetweenInclusive, enumerateDates } from "./dateUtils";
import { previousRange, type DateRange } from "./range";
import type { ComparisonAvailability } from "./comparison";

// One ABC incident, as returned by get_abc_trend_data() (migration 0051)
// -- deliberately excludes perceived_function/general_notes/clinical_notes
// at the query level. incident_date is a real DATE column, not a
// timestamptz, so no local-timezone conversion is needed the way
// useDailyPatterns.ts needs one for checked_in_at/submitted_at.
export interface AbcTrendEntry {
  id: string;
  incidentDate: string;
  loggedByRole: string;
  antecedents: string[];
  behaviours: string[];
  consequences: string[];
}

function withinRange(date: string, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

export function entriesInRange(entries: AbcTrendEntry[], range: DateRange): AbcTrendEntry[] {
  return entries.filter((e) => withinRange(e.incidentDate, range));
}

// ============================================================
// Bucket boundaries -- bucketed by day/week/month depending on the
// period length, so a 7-day range reads as one point per day while a
// 90-day or "all time" range doesn't render dozens of single-day
// points. Bucket boundaries are plain calendar chunks from range.start,
// not an invented "smart" grouping -- every incident lands in exactly
// one bucket. Consumed by unifiedTrends.ts's buildTrendBuckets, which
// keeps empty buckets at a real 0 count (never skipped, so a quiet week
// reads as quiet, not as missing).
// ============================================================
function bucketSizeDays(periodLengthDays: number): number {
  if (periodLengthDays <= 10) return 1; // daily
  if (periodLengthDays <= 120) return 7; // weekly
  return 30; // monthly (approximate -- calendar-month-accurate isn't needed for a bar label)
}

function formatBucketLabel(start: string, end: string, size: number): string {
  const startDate = new Date(`${start}T00:00:00`);
  const short = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (size === 1) return short(startDate);
  const endDate = new Date(`${end}T00:00:00`);
  return `${short(startDate)}–${short(endDate)}`;
}

export interface DateBucket {
  label: string;
  start: string;
  end: string;
}

// Shared bucket-boundary builder -- the Unified Trends graph's incidents/
// morning-regulation/school-regulation series all need the exact same
// day/week/month chunking of a range so their lines land on the same
// x-axis buckets. Kept here (not duplicated) so that alignment is
// structural, not something call sites have to keep in sync by hand.
export function buildDateBuckets(range: DateRange): DateBucket[] {
  const periodLength = daysBetweenInclusive(range.start, range.end);
  const size = bucketSizeDays(periodLength);
  const buckets: DateBucket[] = [];
  let cursor = range.start;
  while (cursor <= range.end) {
    const end = addDays(cursor, size - 1) > range.end ? range.end : addDays(cursor, size - 1);
    buckets.push({ label: formatBucketLabel(cursor, end, size), start: cursor, end });
    cursor = addDays(end, 1);
  }
  return buckets;
}

// ============================================================
// Categorical breakdowns -- tallies the real values already present on
// each incident (antecedents/behaviours/consequences are text[] against
// a fixed per-role option set, see abc-logger/roleConfig.ts). Never
// invented buckets -- mirrors fba/abcAnalysis.ts's tallyCategorical,
// duplicated rather than imported since that module's AbcLogSummary
// shape carries fields (antecedentOther, perceivedFunction, ...) this
// narrower Progress entry deliberately doesn't have.
// ============================================================
export interface CategoryTally {
  label: string;
  count: number;
}

function tallyCategorical(values: string[][]): CategoryTally[] {
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

export type AbcCategoryKind = "antecedents" | "behaviours" | "consequences";

export function tallyCategory(entries: AbcTrendEntry[], range: DateRange, kind: AbcCategoryKind): CategoryTally[] {
  const inRange = entriesInRange(entries, range);
  return tallyCategorical(inRange.map((e) => e[kind]));
}

// ============================================================
// Frequency comparison (period vs previous) -- gated by the SAME
// comparison-availability signal as the regulation charts (constraint
// 6's density threshold is one honesty rule shared across every Progress
// comparison, not a separate ABC-specific one). An incident-free week
// with full check-in coverage is real, present data, not "sparse", so
// this takes the already-computed ComparisonAvailability from
// comparison.ts rather than inventing a second notion of "enough data".
// ============================================================
export interface FrequencyComparison {
  currentCount: number;
  previousCount: number;
  direction: "more" | "fewer" | "steady";
}

export function compareFrequency(
  entries: AbcTrendEntry[],
  range: DateRange,
  availability: ComparisonAvailability
): FrequencyComparison | null {
  if (!availability.available) return null;
  const prev = previousRange(range);
  if (!prev) return null;
  const currentCount = entriesInRange(entries, range).length;
  const previousCount = entriesInRange(entries, prev).length;
  const delta = currentCount - previousCount;
  // A single-incident difference reads as noise, not a direction --
  // same "steady" banding rule as comparison.ts's regulation compare.
  const direction: FrequencyComparison["direction"] = delta > 1 ? "more" : delta < -1 ? "fewer" : "steady";
  return { currentCount, previousCount, direction };
}

// Constraint: "Parent tone rules extend to ABC/flags: incident increases
// phrased neutrally." Never an alert, never a percentage, no red -- the
// exact same posture as parentDistributionToneCopy in comparison.ts.
export function parentFrequencyToneCopy(comparison: FrequencyComparison): string {
  const { direction, currentCount, previousCount } = comparison;
  if (direction === "more") {
    return `A few more logged incidents than last period (${currentCount} vs ${previousCount}).`;
  }
  if (direction === "fewer") {
    return `Fewer logged incidents than last period -- lovely to see.`;
  }
  return "About the same as last period.";
}

export function professionalFrequencyToneCopy(comparison: FrequencyComparison): string {
  const { currentCount, previousCount, direction } = comparison;
  const delta = currentCount - previousCount;
  const sign = delta > 0 ? "+" : "";
  return `Incidents: ${currentCount} this period vs ${previousCount} previous (${sign}${delta}, ${direction}).`;
}

// Re-exported for callers that only have a plain date list handy (kept
// here rather than importing enumerateDates separately everywhere).
export { enumerateDates };
