import { countDataDays, summarizeDistribution, type DayEntry, type StateDistribution } from "./regulation";
import { daysBetweenInclusive } from "./dateUtils";
import { densityThreshold, meetsThreshold, previousRange, type DateRange } from "./range";

// Constraint 6: a trend statement/direction indicator requires a full
// compared period -- both the selected range AND the immediately
// preceding equal-length range must independently clear the density
// threshold. "all time" has no previous-equal-range (see previousRange)
// and never produces a comparison, by construction, not by a special
// case here.
export interface PeriodComparison {
  current: StateDistribution;
  previous: StateDistribution;
  settledDeltaDays: number; // current.settled - previous.settled, informational only
  direction: "more-settled" | "more-unsettled" | "steady";
}

export interface ComparisonAvailability {
  available: boolean;
  currentDataDays: number;
  previousDataDays: number;
  threshold: number;
  // How many more logged days the CURRENT period alone needs to clear
  // the threshold -- the number the empty/sparse-state ladder shows.
  // Only meaningful when the current period itself is short of it.
  moreNeededForCurrent: number;
}

export function evaluateComparisonAvailability(
  morningEntries: DayEntry[],
  range: DateRange
): ComparisonAvailability {
  const periodLength = daysBetweenInclusive(range.start, range.end);
  const threshold = densityThreshold(periodLength);
  const currentDataDays = countDataDays(morningEntries, range);
  const prev = previousRange(range);

  if (!prev) {
    return { available: false, currentDataDays, previousDataDays: 0, threshold, moreNeededForCurrent: Math.max(0, threshold - currentDataDays) };
  }

  const previousDataDays = countDataDays(morningEntries, prev);
  const available = meetsThreshold(currentDataDays, periodLength) && meetsThreshold(previousDataDays, periodLength);

  return {
    available,
    currentDataDays,
    previousDataDays,
    threshold,
    moreNeededForCurrent: Math.max(0, threshold - currentDataDays),
  };
}

export function comparePeriods(morningEntries: DayEntry[], range: DateRange): PeriodComparison | null {
  const availability = evaluateComparisonAvailability(morningEntries, range);
  if (!availability.available) return null;

  const prev = previousRange(range);
  if (!prev) return null;

  const current = summarizeDistribution(morningEntries, range);
  const previous = summarizeDistribution(morningEntries, prev);
  const settledDeltaDays = current.settled - previous.settled;

  // A single day's difference reads as noise, not a direction -- "steady"
  // covers that band rather than calling a 1-day wobble a trend either way.
  const direction: PeriodComparison["direction"] =
    settledDeltaDays > 1 ? "more-settled" : settledDeltaDays < -1 ? "more-unsettled" : "steady";

  return { current, previous, settledDeltaDays, direction };
}

// ============================================================
// Tone-safe copy (constraint: parent tone rules, testable). These are
// the ONLY place comparison copy is generated for the parent lens --
// centralising it here is what makes it testable/auditable as one
// small surface, rather than phrasing being decided ad hoc at each
// render site.
// ============================================================

export function parentDistributionToneCopy(comparison: PeriodComparison): string {
  const { direction, settledDeltaDays } = comparison;
  if (direction === "more-settled") {
    return `${Math.abs(settledDeltaDays)} more settled morning${Math.abs(settledDeltaDays) === 1 ? "" : "s"} than last period -- lovely to see.`;
  }
  if (direction === "more-unsettled") {
    // Neutral, never framed as an alert or a percentage drop -- constraint's
    // exact example: "more unsettled mornings than last month".
    return `A few more unsettled mornings than last period.`;
  }
  return "About the same as last period.";
}

export function professionalDistributionToneCopy(comparison: PeriodComparison): string {
  const { current, previous, settledDeltaDays } = comparison;
  const sign = settledDeltaDays > 0 ? "+" : "";
  return `Settled days: ${current.settled}/${current.totalDays} this period vs ${previous.settled}/${previous.totalDays} previous (${sign}${settledDeltaDays}).`;
}
