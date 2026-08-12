import { previousRange, type DateRange } from "./range";

// Minimal shape this module needs from useDailyPatterns's TeacherUpdateEntry
// -- kept structural rather than importing the hook's type, since this is
// a pure-logic module and that type lives in a "use client" hook file.
export interface FlagDayEntry {
  date: string;
  flags: string[];
}

function withinRange(date: string, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

function tallyFlags(entries: FlagDayEntry[], range: DateRange): Map<string, number> {
  const tally = new Map<string, number>();
  for (const entry of entries) {
    if (!withinRange(entry.date, range)) continue;
    for (const flag of entry.flags) {
      tally.set(flag, (tally.get(flag) ?? 0) + 1);
    }
  }
  return tally;
}

export interface FlagTrendEntry {
  flag: string;
  current: number;
  previous: number;
  direction: "rising" | "fading" | "steady" | "new";
}

// Rising/fading flag trends -- gated by the SAME comparison-availability
// signal as the regulation/frequency comparisons (passed in by the
// caller, not recomputed here) so a flag never gets a confident
// "rising"/"fading" label off a sparse period. Returns null when that
// gate isn't clear, same honesty posture as comparePeriods/compareFrequency.
export function compareFlagTrends(
  entries: FlagDayEntry[],
  range: DateRange,
  comparisonAvailable: boolean
): FlagTrendEntry[] | null {
  if (!comparisonAvailable) return null;
  const prev = previousRange(range);
  if (!prev) return null;

  const current = tallyFlags(entries, range);
  const previous = tallyFlags(entries, prev);
  const allFlags = new Set([...current.keys(), ...previous.keys()]);

  const results: FlagTrendEntry[] = [];
  for (const flag of allFlags) {
    const curr = current.get(flag) ?? 0;
    const prevCount = previous.get(flag) ?? 0;
    const delta = curr - prevCount;
    let direction: FlagTrendEntry["direction"];
    if (prevCount === 0 && curr > 0) direction = "new";
    else if (delta > 0) direction = "rising";
    else if (delta < 0) direction = "fading";
    else direction = "steady";
    results.push({ flag, current: curr, previous: prevCount, direction });
  }

  // Rising and new flags first (what a reader most wants to notice),
  // then fading, then steady -- each group sorted by current volume.
  const rank: Record<FlagTrendEntry["direction"], number> = { new: 0, rising: 1, fading: 2, steady: 3 };
  return results
    .filter((r) => r.current > 0 || r.previous > 0)
    .sort((a, b) => rank[a.direction] - rank[b.direction] || b.current - a.current);
}

// Current-period flag counts alone, for when there's no valid previous
// period to compare against (e.g. "all time", or a sparse account) --
// still worth showing factually, just without a rising/fading label.
export function currentFlagCounts(entries: FlagDayEntry[], range: DateRange): { flag: string; count: number }[] {
  const tally = tallyFlags(entries, range);
  return Array.from(tally.entries())
    .map(([flag, count]) => ({ flag, count }))
    .sort((a, b) => b.count - a.count);
}
