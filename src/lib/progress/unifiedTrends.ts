import { buildDateBuckets, entriesInRange, type AbcTrendEntry } from "./abc";
import { countDataDays, REGULATION_STATE_COLOR, REGULATION_STATE_LABEL, type DayEntry, type RegulationState } from "./regulation";
import { weekdayIndex, WEEKDAY_SHORT_LABELS, enumerateDates } from "./dateUtils";
import { densityThreshold, meetsThreshold, type DateRange } from "./range";

// The Unified Trends graph (chart evolution brief): one multi-series line
// graph replacing the old incidents-over-time bars, the incident
// day-of-week bars, and the regulation day-of-week bars, with morning/
// school regulation added as lines alongside incidents. This module is
// the pure-data half; UnifiedTrendsChart.tsx is the render half.

export type TrendSeriesId = "incidents" | "morningRegulation" | "schoolRegulation";

// Settled=3 / Unsettled=2 / Highly Dysregulated=1, per the brief's own
// scale. Regulation is plotted against this 1-3 score, never raw state
// strings, so a bucket/weekday with a MIX of states can still average to
// a single line height.
export const STATE_SCORE: Record<RegulationState, number> = {
  dysregulated: 1,
  unsettled: 2,
  settled: 3,
};
export const STATE_SCORE_MIN = 1;
export const STATE_SCORE_MAX = 3;

// Marker colour for an averaged point: nearest whole state, rounded
// half-up so a 2.5 (evenly split unsettled/settled) reads as settled
// rather than arbitrarily favouring the worse state. This only affects
// the DOT colour -- the connecting LINE never takes a state colour (see
// UnifiedTrendsChart's own header comment on the "no red line" rule).
export function nearestState(score: number): RegulationState {
  if (score >= (STATE_SCORE.unsettled + STATE_SCORE.settled) / 2) return "settled";
  if (score >= (STATE_SCORE.dysregulated + STATE_SCORE.unsettled) / 2) return "unsettled";
  return "dysregulated";
}

function averageState(entries: DayEntry[], start: string, end: string): { avg: number | null; dataDays: number } {
  const inRange = entries.filter((e) => e.date >= start && e.date <= end && e.state);
  if (inRange.length === 0) return { avg: null, dataDays: 0 };
  const sum = inRange.reduce((acc, e) => acc + STATE_SCORE[e.state as RegulationState], 0);
  return { avg: sum / inRange.length, dataDays: inRange.length };
}

// ============================================================
// Over-time buckets -- reuses buildDateBuckets (abc.ts) so incidents,
// morning regulation and school regulation all land on the exact same
// bucket boundaries (daily at a 7-day range, weekly at 30/90/all, same
// bucketSizeDays rule the old frequency chart already used). A bucket
// with zero check-ins is a genuine GAP (avg = null, rendered as a break
// in the line -- brief's own requirement), never coerced to 0; a bucket
// with zero incidents is a real, meaningful zero (kept as 0, matching
// the old frequency chart's "a quiet week reads as quiet" rule).
// ============================================================
export interface TrendBucket {
  label: string;
  start: string;
  end: string;
  incidentCount: number;
  morningAvgState: number | null;
  morningDataDays: number;
  schoolAvgState: number | null;
  schoolDataDays: number;
  hasStrategyMarker: boolean;
}

export function buildTrendBuckets(
  morningEntries: DayEntry[],
  afternoonEntries: DayEntry[],
  abcEntries: AbcTrendEntry[],
  range: DateRange,
  strategyDates: string[]
): TrendBucket[] {
  return buildDateBuckets(range).map((b) => {
    const morning = averageState(morningEntries, b.start, b.end);
    const school = averageState(afternoonEntries, b.start, b.end);
    const incidentCount = entriesInRange(abcEntries, { start: b.start, end: b.end }).length;
    const hasStrategyMarker = strategyDates.some((d) => d >= b.start && d <= b.end);
    return {
      label: b.label,
      start: b.start,
      end: b.end,
      incidentCount,
      morningAvgState: morning.avg,
      morningDataDays: morning.dataDays,
      schoolAvgState: school.avg,
      schoolDataDays: school.dataDays,
      hasStrategyMarker,
    };
  });
}

// ============================================================
// Weekday buckets -- "Weekday mode re-buckets every visible series to
// Mon-Sun averages: incidents = avg per weekday; regulation = avg state
// per weekday" (brief's own wording). Incident average is per
// OCCURRENCE of that weekday within the range (total incidents on that
// weekday / number of times that weekday occurred), not per calendar
// day overall -- otherwise a range with e.g. 4 Mondays and 5 Tuesdays
// would understate Mondays relative to Tuesdays for no real reason.
// ============================================================
export interface WeekdayTrendBucket {
  weekday: number; // 0=Sun..6=Sat, Date#getDay() convention
  label: string;
  incidentAvg: number;
  incidentOccurrences: number;
  morningAvgState: number | null;
  morningDataDays: number;
  schoolAvgState: number | null;
  schoolDataDays: number;
}

// Monday-first display order, matching every other weekday chart in
// this codebase (abc.ts's summarizeIncidentsByWeekday did the same).
const MONDAY_FIRST_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function buildWeekdayTrendBuckets(
  morningEntries: DayEntry[],
  afternoonEntries: DayEntry[],
  abcEntries: AbcTrendEntry[],
  range: DateRange
): WeekdayTrendBucket[] {
  const allDays = enumerateDates(range.start, range.end);
  const occurrencesByWeekday = new Array(7).fill(0) as number[];
  for (const date of allDays) occurrencesByWeekday[weekdayIndex(date)] += 1;

  const incidentCountByWeekday = new Array(7).fill(0) as number[];
  for (const e of abcEntries) {
    if (e.incidentDate < range.start || e.incidentDate > range.end) continue;
    incidentCountByWeekday[weekdayIndex(e.incidentDate)] += 1;
  }

  const morningByWeekday: DayEntry[][] = Array.from({ length: 7 }, () => []);
  for (const e of morningEntries) {
    if (e.date < range.start || e.date > range.end || !e.state) continue;
    morningByWeekday[weekdayIndex(e.date)].push(e);
  }
  const schoolByWeekday: DayEntry[][] = Array.from({ length: 7 }, () => []);
  for (const e of afternoonEntries) {
    if (e.date < range.start || e.date > range.end || !e.state) continue;
    schoolByWeekday[weekdayIndex(e.date)].push(e);
  }

  return MONDAY_FIRST_ORDER.map((weekday) => {
    const occurrences = occurrencesByWeekday[weekday];
    const morning = morningByWeekday[weekday];
    const school = schoolByWeekday[weekday];
    const morningAvg =
      morning.length > 0 ? morning.reduce((acc, e) => acc + STATE_SCORE[e.state as RegulationState], 0) / morning.length : null;
    const schoolAvg =
      school.length > 0 ? school.reduce((acc, e) => acc + STATE_SCORE[e.state as RegulationState], 0) / school.length : null;
    return {
      weekday,
      label: WEEKDAY_SHORT_LABELS[weekday],
      incidentAvg: occurrences > 0 ? incidentCountByWeekday[weekday] / occurrences : 0,
      incidentOccurrences: occurrences,
      morningAvgState: morningAvg,
      morningDataDays: morning.length,
      schoolAvgState: schoolAvg,
      schoolDataDays: school.length,
    };
  });
}

// ============================================================
// Per-series thresholds (brief's constraint 6, extended from the
// existing whole-surface density rule to apply per series individually).
// Reuses the same densityThreshold/meetsThreshold formula (>=4 data days
// per 7-day period) rather than inventing a second threshold -- one rule,
// applied three times.
//
// Judgment call: incidents don't have a "was logging attempted" signal
// the way check-ins do (an ABC log only exists when something happened;
// a quiet day never produces a row either way), so there's no clean
// "diligence day count" for that series. Rather than leave incidents
// exempt from constraint 6 entirely, this counts DISTINCT INCIDENT-DAYS
// in range against the same threshold formula -- a low-incident-count
// range renders as scattered points same as a low-check-in-count range,
// which is the more honest reading of "never a confident line" than
// treating incidents as immune to sparse-state handling.
// ============================================================
export type SeriesThresholdState = "empty" | "sparse" | "confident";

export function seriesThresholdState(dataDayCount: number, periodLengthDays: number): SeriesThresholdState {
  if (dataDayCount === 0) return "empty";
  return meetsThreshold(dataDayCount, periodLengthDays) ? "confident" : "sparse";
}

export function incidentDataDayCount(entries: AbcTrendEntry[], range: DateRange): number {
  const days = new Set<string>();
  for (const e of entries) {
    if (e.incidentDate >= range.start && e.incidentDate <= range.end) days.add(e.incidentDate);
  }
  return days.size;
}

export interface SeriesDataCounts {
  incidents: number;
  morningRegulation: number;
  schoolRegulation: number;
}

export function computeSeriesDataCounts(
  morningEntries: DayEntry[],
  afternoonEntries: DayEntry[],
  abcEntries: AbcTrendEntry[],
  range: DateRange
): SeriesDataCounts {
  return {
    incidents: incidentDataDayCount(abcEntries, range),
    morningRegulation: countDataDays(morningEntries, range),
    schoolRegulation: countDataDays(afternoonEntries, range),
  };
}

// unlockNeeded copy for a single series -- same "N more days" ladder
// language as emptyStateCopy.ts's sparseDataCopy, scoped to one series
// rather than the whole surface.
export function seriesUnlockHint(dataDayCount: number, periodLengthDays: number): string {
  const needed = Math.max(0, densityThreshold(periodLengthDays) - dataDayCount);
  if (needed <= 0) return "Enough data for a confident trend line.";
  return `${needed} more day${needed === 1 ? "" : "s"} unlocks a confident trend line.`;
}

// ============================================================
// Series presentation -- colour, label, and the marker-colour rule.
// Incidents: Prussian Blue, brand's own primary chart colour everywhere
// else in this module already. Morning regulation: a warm neutral
// (never blue, never a state colour) so the LINE itself can never read
// as "the red line" for the parent lens even on a rough patch -- state
// colour is reserved for the per-point marker only. School regulation:
// a mid-tone from the Pastel-Blue family (brief's own instruction) --
// literal --color-pastel-blue (#bad9eb) is too pale to read as a line
// against a white card at 375px, so this uses #3E7CB1, the same
// "school" blue CrossSettingComparison already established elsewhere in
// this exact feature, not a new hue invented for this chart.
//
// Palette run through the dataviz skill's validator
// (scripts/validate_palette.js "#004F71,#9A8B7A,#3E7CB1" --mode light):
// every ADJACENT-PAIR check (CVD separation, normal-vision floor) PASSES
// -- the two FAILs it reports are intrinsic to Prussian Blue alone
// (lightness/chroma), a fixed brand token this feature can't repaint,
// not a distinguishability problem between series. Mitigated per the
// skill's own prescription for that case: identity never depends on
// colour alone here -- every series has an always-visible text-labelled
// legend chip, and the strategy marker uses a dashed line style, not a
// fourth colour, to stay distinct from all three.
export const TREND_SERIES_META: Record<TrendSeriesId, { label: string; color: string }> = {
  incidents: { label: "Incidents", color: "#004F71" },
  morningRegulation: { label: "Morning regulation", color: "#9A8B7A" },
  schoolRegulation: { label: "School regulation", color: "#3E7CB1" },
};

// Per-lens defaults (constraint 5). Parent: morning regulation +
// incidents on, school off by default even when available (still
// toggleable) -- "defaults on" per the brief names exactly those two.
// Teacher/clinician: all three on -- teacher's read of these three
// specific series is already their full existing scope (own check-ins,
// own EOD, the ABC data they already read), so there's no narrower
// default to apply beyond the school-availability gate itself.
export function defaultActiveSeries(role: "parent" | "teacher" | "clinician"): TrendSeriesId[] {
  if (role === "parent") return ["morningRegulation", "incidents"];
  return ["incidents", "morningRegulation", "schoolRegulation"];
}

export { REGULATION_STATE_COLOR, REGULATION_STATE_LABEL };
