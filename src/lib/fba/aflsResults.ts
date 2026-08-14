import type { AflsScores, AflsTaskScore, InstrumentItem } from "./types";

// AFLS RESULTS: THE MOBILE TRACKING GRID (STEP 3). Presentation-only
// utilities for the new numeric per-task scoring model (migration
// 0060) -- replaces the old qualitative independent/assisted/unable/na
// encoding entirely (aflsResults.ts's previous contents), since a task
// now scores 0..maxScore against its OWN scale rather than a single
// universal 4-state pick.

// A cell's display state: "unscored" (no entry at all -- dashed empty)
// and "na" (explicitly marked N/A -- hatched/muted) are both
// display-only categorisations, never stored values themselves; only
// a plain number is ever actually written to AflsScores.
export type AflsCellState = "unscored" | "na" | "scored";

export function cellStateFor(score: AflsTaskScore | undefined): AflsCellState {
  if (score === undefined) return "unscored";
  if (score === "NA") return "na";
  return "scored";
}

// 0..1, how "full" a scored cell's fill should read -- score 0 still
// reports intensity 0 but is a DISTINCT state from "unscored" (a real,
// recorded zero vs. nothing recorded at all), which the caller must
// render differently (see AflsResultsGrid's off-white-with-outline vs.
// dashed-transparent treatment).
export function cellIntensity(score: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.min(Math.max(score / maxScore, 0), 1);
}

export interface DomainPoints {
  domainCode: string;
  // Points actually earned so far (numeric scores only).
  earned: number;
  // The domain's achievable ceiling EXCLUDING tasks marked N/A --
  // stays the same whether a task is unscored or scored, only
  // shrinking when a task is marked N/A. This is what makes a partial
  // assessment's "41/68" read honestly: 68 is what's achievable across
  // every scoreable task in the domain, not just the ones touched yet.
  possible: number;
  naCount: number;
  unscoredCount: number;
  totalTasks: number;
}

export function computeDomainPoints(domainCode: string, items: InstrumentItem[], scores: AflsScores): DomainPoints {
  let earned = 0;
  let possible = 0;
  let naCount = 0;
  let unscoredCount = 0;

  for (const item of items) {
    const value = scores[item.id];
    const max = item.maxScore ?? 0;
    if (value === "NA") {
      naCount += 1;
      continue;
    }
    possible += max;
    if (value === undefined) {
      unscoredCount += 1;
    } else {
      earned += value;
    }
  }

  return { domainCode, earned, possible, naCount, unscoredCount, totalTasks: items.length };
}

// "41/68 points" or "41/68 points · 3 NA" -- the NA clause omitted
// entirely when zero, matching the honeycomb-era micro-summary's own
// omit-zero convention.
export function formatDomainSummary(points: DomainPoints): string {
  const base = `${points.earned}/${points.possible} points`;
  return points.naCount > 0 ? `${base} · ${points.naCount} NA` : base;
}

// True only when NOTHING has been scored anywhere across every
// assessment -- the brief's "zero AFLS data" edge case.
export function isAflsResultsEmpty(assessments: { scores: AflsScores }[]): boolean {
  return assessments.every((a) => Object.keys(a.scores ?? {}).length === 0);
}
