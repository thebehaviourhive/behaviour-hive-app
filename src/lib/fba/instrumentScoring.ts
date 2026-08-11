import type { InstrumentItem, InstrumentResponsesData } from "./types";

// A scale entry meaning "this item doesn't apply -- exclude it from
// scoring entirely, from both the total AND that category's possible
// maximum." Present in the real QABF's scale (['X','0','1','2','3']),
// absent from every other scale (MAS's word labels, the old placeholder
// scales) -- detected generically per-item via `scale.includes(...)`,
// not by instrument type, so any future instrument that wants the same
// exclusion behaviour just needs this in its own scale array.
const EXCLUDED_ANSWER = "X";

function hasExclusionOption(scale: string[]): boolean {
  return scale.includes(EXCLUDED_ANSWER);
}

// Point value for one answered item. For an exclusion-aware scale, the
// marker shifts every other option's array position by one ('X' sits at
// index 0), so position can't be used as the point value the way it is
// everywhere else -- instead each option's own label text IS its point
// value ("0"->0, "3"->3), which only works because those labels are
// literal digit strings. Word-label scales (MAS, AFLS, legacy) are
// untouched: same scale.indexOf(answer) as before.
function pointsFor(item: InstrumentItem, answer: string): number | null {
  if (!item.scale) return null;
  if (hasExclusionOption(item.scale)) {
    if (answer === EXCLUDED_ANSWER) return null;
    const value = Number(answer);
    return Number.isFinite(value) ? value : null;
  }
  const index = item.scale.indexOf(answer);
  return index >= 0 ? index : null;
}

// Sums each answered, non-excluded item's point value into its
// category. Unanswered items and 'X' answers contribute nothing --
// silently skipped, not scored as zero, since a 0 is a genuine clinical
// answer on the QABF's own scale and must stay distinguishable from
// "doesn't apply".
export function scoreInstrumentByCategory(
  items: InstrumentItem[],
  responses: InstrumentResponsesData
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const item of items) {
    if (!item.category) continue;
    const answer = responses[item.id];
    if (answer === undefined) continue;
    const points = pointsFor(item, answer);
    if (points === null) continue;
    totals[item.category] = (totals[item.category] ?? 0) + points;
  }
  return totals;
}

// The highest possible total for each category. For a plain scale this
// is a fixed per-item constant (scale.length - 1) regardless of what
// was actually answered, exactly as before. For an exclusion-aware
// scale it genuinely depends on the responses: an item answered 'X' (or
// not yet answered at all) contributes NOTHING to the max, not its full
// point range -- so `responses` is now a required input here, not an
// optional afterthought, since the two scoring functions must agree on
// what "possible" means for the same response set.
export function getCategoryMaxScores(
  items: InstrumentItem[],
  responses: InstrumentResponsesData
): Record<string, number> {
  const maxes: Record<string, number> = {};
  for (const item of items) {
    if (!item.category || !item.scale) continue;

    if (hasExclusionOption(item.scale)) {
      const answer = responses[item.id];
      if (answer === undefined || answer === EXCLUDED_ANSWER) continue;
      const numericOptions = item.scale.filter((label) => label !== EXCLUDED_ANSWER).map(Number);
      const maxPoints = Math.max(...numericOptions);
      maxes[item.category] = (maxes[item.category] ?? 0) + maxPoints;
    } else {
      const maxPoints = item.scale.length - 1;
      maxes[item.category] = (maxes[item.category] ?? 0) + maxPoints;
    }
  }
  return maxes;
}
