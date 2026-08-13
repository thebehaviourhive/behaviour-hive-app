import { enumerateDates, isoToLocalDateString } from "./dateUtils";
import type { DateRange } from "./range";

// Same DB enum as morning_checkins.regulation_state / teacher_updates.
// settled_state -- see dailyPatterns.ts's own header comment: this is a
// deliberate independent copy (there's no shared constants file for
// this anywhere in the codebase), not a drift risk introduced here.
export type RegulationState = "settled" | "unsettled" | "dysregulated";

export const REGULATION_STATE_ORDER: RegulationState[] = ["settled", "unsettled", "dysregulated"];

// Colours read straight from the parent dashboard's own SETTLED_BADGE
// (src/app/parent-dashboard/page.tsx) -- the canonical, most-visible
// treatment of these three states in the app today. Not a new palette.
export const REGULATION_STATE_COLOR: Record<RegulationState, { dot: string; bg: string; text: string; hex: string }> = {
  settled: { dot: "bg-green-500", bg: "bg-green-50", text: "text-green-800", hex: "#22c55e" },
  unsettled: { dot: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-800", hex: "#f59e0b" },
  dysregulated: { dot: "bg-red-500", bg: "bg-red-50", text: "text-red-800", hex: "#ef4444" },
};

export const REGULATION_STATE_LABEL: Record<RegulationState, string> = {
  settled: "Settled and Regulated",
  unsettled: "Unsettled and Anxious",
  dysregulated: "Highly Dysregulated",
};

export interface DayEntry {
  date: string;
  state: RegulationState | null;
}

// ============================================================
// Calendar bucketing -- one row per calendar day in the range, with the
// day's morning check-in state and (optionally) afternoon EOD state
// resolved independently. Multiple same-day rows use the LATEST
// submission (entries are expected pre-sorted ascending, matching
// useDailyPatterns' own fetch order).
// ============================================================

export interface CalendarDay {
  date: string;
  morning: RegulationState | null;
  afternoon: RegulationState | null;
}

export function buildCalendar(
  morningEntries: DayEntry[],
  afternoonEntries: DayEntry[],
  range: DateRange
): CalendarDay[] {
  const morningByDate = new Map<string, RegulationState | null>();
  for (const e of morningEntries) morningByDate.set(e.date, e.state);
  const afternoonByDate = new Map<string, RegulationState | null>();
  for (const e of afternoonEntries) afternoonByDate.set(e.date, e.state);

  return enumerateDates(range.start, range.end).map((date) => ({
    date,
    morning: morningByDate.get(date) ?? null,
    afternoon: afternoonByDate.get(date) ?? null,
  }));
}

// ============================================================
// State distribution -- morning check-in is treated as the day's
// "official" single regulation reading (the child's own state, logged
// by the parent each morning); afternoon EOD is the paired second
// series on the calendar chart, not double-counted into this
// distribution. Same rule for all three roles -- RLS already governs
// what data actually reaches each one, not this aggregation.
// ============================================================

export interface StateDistribution {
  settled: number;
  unsettled: number;
  dysregulated: number;
  noData: number;
  totalDays: number;
}

export function summarizeDistribution(morningEntries: DayEntry[], range: DateRange): StateDistribution {
  const calendar = buildCalendar(morningEntries, [], range);
  const dist: StateDistribution = { settled: 0, unsettled: 0, dysregulated: 0, noData: 0, totalDays: calendar.length };
  for (const day of calendar) {
    if (!day.morning) dist.noData += 1;
    else dist[day.morning] += 1;
  }
  return dist;
}

// Data-day count for the density-threshold rule -- a "data day" is any
// day with a genuine morning check-in, regardless of what state it was.
export function countDataDays(morningEntries: DayEntry[], range: DateRange): number {
  const dist = summarizeDistribution(morningEntries, range);
  return dist.totalDays - dist.noData;
}

// ============================================================
// Streaks (parent lens) -- current/best run of consecutive settled
// mornings, and current/best run of consecutive days with a check-in
// logged at all (regardless of state). Computed over the FULL history
// passed in, not scoped to the selected range -- a streak that started
// before the visible window is still real and still worth celebrating.
// ============================================================

export interface StreakSummary {
  currentSettledStreak: number;
  bestSettledStreak: number;
  currentCheckinStreak: number;
  bestCheckinStreak: number;
}

export function computeStreaks(allMorningEntries: DayEntry[], today: string): StreakSummary {
  if (allMorningEntries.length === 0) {
    return { currentSettledStreak: 0, bestSettledStreak: 0, currentCheckinStreak: 0, bestCheckinStreak: 0 };
  }

  const byDate = new Map<string, RegulationState | null>();
  for (const e of allMorningEntries) byDate.set(e.date, e.state);

  const sortedDates = Array.from(byDate.keys()).sort();
  const earliest = sortedDates[0];
  const allDays = enumerateDates(earliest, today);

  let bestSettled = 0;
  let runSettled = 0;
  let bestCheckin = 0;
  let runCheckin = 0;

  for (const date of allDays) {
    const state = byDate.get(date);
    if (state) {
      runCheckin += 1;
      bestCheckin = Math.max(bestCheckin, runCheckin);
    } else {
      runCheckin = 0;
    }

    if (state === "settled") {
      runSettled += 1;
      bestSettled = Math.max(bestSettled, runSettled);
    } else {
      runSettled = 0;
    }
  }

  // "Current" streaks: walking back from today, so a gap yesterday
  // correctly zeroes them out even if today itself has no entry yet.
  // Two independent walks -- a non-settled-but-present check-in ends
  // the settled streak without ending the check-in-logging streak, so
  // they can't share one loop/break condition.
  let currentSettled = 0;
  for (let i = allDays.length - 1; i >= 0; i--) {
    const date = allDays[i];
    const state = byDate.get(date);
    if (date === today && !state) continue; // today may just not have happened yet
    if (state !== "settled") break;
    currentSettled += 1;
  }

  let currentCheckin = 0;
  for (let i = allDays.length - 1; i >= 0; i--) {
    const date = allDays[i];
    const state = byDate.get(date);
    if (date === today && !state) continue;
    if (!state) break;
    currentCheckin += 1;
  }

  return {
    currentSettledStreak: currentSettled,
    bestSettledStreak: bestSettled,
    currentCheckinStreak: currentCheckin,
    bestCheckinStreak: bestCheckin,
  };
}

// ============================================================
// Row shaping -- converts the raw Supabase rows (as already fetched by
// useDailyPatterns) into the DayEntry[] shape this module works with.
// ============================================================

export function toDayEntries(
  rows: { submittedAtIso: string; state: RegulationState | null }[]
): DayEntry[] {
  return rows.map((r) => ({ date: isoToLocalDateString(r.submittedAtIso), state: r.state }));
}
