// Stage 3's own sample-size threshold, separate from the Progress
// feature's day-density one (src/lib/progress/range.ts) -- that one
// measures "days with data in a rolling window", meaningless here where
// the unit is "ratings on a strategy", not calendar coverage. The
// brief's own worked example ("Early signal — 3 ratings") is taken as
// the literal cutoff: below 3 ratings, a strategy's proportions are
// shown as an honest partial chart (never hidden) alongside an
// early-signal banner; at 3+ they're shown with no banner, same
// "confident vs sparse, chart never hidden" posture as Progress.
export const MIN_RATINGS_FOR_CONFIDENCE = 3;

export type RatingSampleState = "empty" | "early" | "confident";

export function ratingSampleState(totalRatings: number): RatingSampleState {
  if (totalRatings === 0) return "empty";
  return totalRatings >= MIN_RATINGS_FOR_CONFIDENCE ? "confident" : "early";
}

// Matches the voice of seriesUnlockHint() in src/lib/progress/unifiedTrends.ts
// ("N more days unlocks a confident trend line"), substituting ratings
// for days.
export function ratingsUnlockHint(totalRatings: number): string {
  const needed = Math.max(0, MIN_RATINGS_FOR_CONFIDENCE - totalRatings);
  if (needed <= 0) return "";
  return `${needed} more rating${needed === 1 ? "" : "s"} unlocks a confident read.`;
}
