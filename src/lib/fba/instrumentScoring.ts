import type { InstrumentItem, InstrumentResponsesData } from "./types";

// Sums each item's point value (its answer's position in the item's own
// `scale` array) into its `category`. Deriving the point value from
// scale.indexOf(answer) rather than hardcoding a 0-4 range means a later
// item-bank replacement (real QABF is 4-point, real MAS is 7-point --
// today's seed data is a uniform 5-point placeholder for both, see
// migration 0040) can't silently desync stored responses from their
// scores -- the scale IS the scoring key.
export function scoreInstrumentByCategory(
  items: InstrumentItem[],
  responses: InstrumentResponsesData
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const item of items) {
    if (!item.category || !item.scale) continue;
    const answer = responses[item.id];
    if (answer === undefined) continue;
    const points = item.scale.indexOf(answer);
    if (points < 0) continue;
    totals[item.category] = (totals[item.category] ?? 0) + points;
  }
  return totals;
}

// The highest possible total for each category, given its item count and
// scale length -- used to size chart bars relative to what's actually
// achievable rather than an assumed constant, since nothing here assumes
// every category has the same number of items.
export function getCategoryMaxScores(items: InstrumentItem[]): Record<string, number> {
  const maxes: Record<string, number> = {};
  for (const item of items) {
    if (!item.category || !item.scale) continue;
    const maxPoints = item.scale.length - 1;
    maxes[item.category] = (maxes[item.category] ?? 0) + maxPoints;
  }
  return maxes;
}
