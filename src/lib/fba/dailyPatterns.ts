// Label maps for Section 8's Daily Patterns panel. No shared constants
// file exists for these anywhere in the codebase today -- the morning
// check-in labels are duplicated locally in src/app/morning-checkin,
// MorningCheckinDetailSheet, and the teacher passport view; the EOD
// labels separately in the EOD wizard and the parent dashboard's
// SETTLED_BADGE. This file doesn't touch or unify those (out of scope
// for an additive stage) -- it's a fifth, FBA-scoped copy of the same
// values, kept here since the Daily Patterns panel is the one place
// that needs BOTH vocabularies side by side. Values must stay in sync
// with the DB check constraints on morning_checkins.regulation_state
// and teacher_updates.settled_state if those ever change.

export type RegulationState = "settled" | "unsettled" | "dysregulated";

// Morning check-in wording (src/app/morning-checkin/page.tsx).
export const MORNING_STATE_LABELS: Record<RegulationState, string> = {
  settled: "Settled and Calm",
  unsettled: "A bit unsettled / Anxious",
  dysregulated: "Highly dysregulated / Upset",
};

// EOD wording (src/app/teacher/eod/[passportId]/page.tsx) -- same enum,
// deliberately different phrasing from the morning labels above.
export const EOD_STATE_LABELS: Record<RegulationState, string> = {
  settled: "Settled and Regulated",
  unsettled: "Unsettled and Anxious",
  dysregulated: "Highly Dysregulated",
};

export const REGULATION_STATE_ORDER: RegulationState[] = ["settled", "unsettled", "dysregulated"];

// ============================================================
// Aggregation -- day-bucketed counts, flag tallies, merged notes.
// Pure functions, no fetching: src/hooks/useDailyPatterns.ts loads the
// raw rows, DirectAssessmentSection filters/summarizes them against the
// same date range already driving the ABC pull.
// ============================================================

export interface DayStateCounts {
  settled: number;
  unsettled: number;
  dysregulated: number;
  noData: number;
}

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  while (cur <= endDate) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// One count per CALENDAR DAY in the range, not per row -- if a day has no
// entry it counts as "no check-in"/"no update", and entries are expected
// pre-sorted ascending by submission time so the last write per date in
// the map is the latest submission if more than one exists for a day.
export function summarizeByDay(
  entries: { date: string; state: RegulationState | null }[],
  rangeStart: string,
  rangeEnd: string
): DayStateCounts {
  const byDate = new Map<string, RegulationState | null>();
  for (const entry of entries) {
    byDate.set(entry.date, entry.state);
  }
  const counts: DayStateCounts = { settled: 0, unsettled: 0, dysregulated: 0, noData: 0 };
  for (const date of enumerateDates(rangeStart, rangeEnd)) {
    const state = byDate.get(date);
    if (!state) {
      counts.noData += 1;
    } else {
      counts[state] += 1;
    }
  }
  return counts;
}

export function tallyFlags(
  entries: { date: string; flags: string[] }[],
  rangeStart: string,
  rangeEnd: string
): { label: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const entry of entries) {
    if (entry.date < rangeStart || entry.date > rangeEnd) continue;
    for (const flag of entry.flags) {
      tally.set(flag, (tally.get(flag) ?? 0) + 1);
    }
  }
  return Array.from(tally.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export interface HeadsUpNote {
  id: string;
  date: string;
  role: "Parent" | "Teacher";
  text: string;
}

export function mergeHeadsUpNotes(
  checkins: { id: string; date: string; headsUp: string | null }[],
  updates: { id: string; date: string; headsUp: string | null }[],
  rangeStart: string,
  rangeEnd: string
): HeadsUpNote[] {
  const notes: HeadsUpNote[] = [];
  for (const c of checkins) {
    if (c.headsUp?.trim() && c.date >= rangeStart && c.date <= rangeEnd) {
      notes.push({ id: c.id, date: c.date, role: "Parent", text: c.headsUp });
    }
  }
  for (const u of updates) {
    if (u.headsUp?.trim() && u.date >= rangeStart && u.date <= rangeEnd) {
      notes.push({ id: u.id, date: u.date, role: "Teacher", text: u.headsUp });
    }
  }
  return notes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
