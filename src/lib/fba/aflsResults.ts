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

// CHANGE 1 (2026-08-21): clinical traffic-light colour coding replaces
// the old Prussian-intensity fill ramp entirely. Exact generic
// colours, deliberately NOT brand tokens -- this is the clinical
// result itself, not app chrome. Shared between AflsResultsGrid (cell
// fills) and AflsResultsLegend (swatches) so the two can never drift
// apart.
export const AFLS_CELL_COLORS = {
  na: "#FFDAB9",
  zero: "#FF0000",
  mid: "#90EE90",
  max: "#006400",
} as const;

// A scored cell falls into exactly one of three discrete tiers
// against its OWN max score (2 or 4) -- "zero" (failed the task
// entirely), "max" (fully independent), or "mid" (everything between,
// i.e. still needs some support/prompting). NA and unscored are their
// own separate states (see cellStateFor above), never tiers of
// "scored".
export type AflsScoreTier = "zero" | "mid" | "max";

export function cellTierFor(score: number, maxScore: number): AflsScoreTier {
  if (score <= 0) return "zero";
  if (maxScore > 0 && score >= maxScore) return "max";
  return "mid";
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
