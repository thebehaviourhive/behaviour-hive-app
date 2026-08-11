import type { AflsItemScore, AflsScoreValue, InstrumentItem } from "./types";

// AFLS results-display encoding (Section 11 REDESIGN). This is
// presentation-only: the score values themselves (AflsScoreValue) are
// untouched, defined in ./types and owned by the input/scoring tool.
// "unscored" is a fifth display-only state -- an item with no entry in
// scoresData -- not a stored value.
export type AflsBadgeValue = AflsScoreValue | "unscored";

export interface AflsBadgeConfig {
  value: AflsBadgeValue;
  label: string;
  // Literal glyph, not an icon component -- guaranteed to render
  // identically in the HTML badges, inside SVG <text> in the honeycomb,
  // and in the printed PDF, with no icon-font/asset dependency.
  icon: string;
  // HTML (div/span) treatment -- `bg-*`/`text-*` set CSS background-color
  // / color.
  bgClass: string;
  textClass: string;
  // SVG treatment -- `background-color`/`color` have no effect on SVG
  // shapes or <text>; fill needs its own `fill-*` classes, deliberately
  // kept separate rather than string-transformed from bgClass/textClass.
  svgFillClass: string;
  svgTextClass: string;
  // Only "unscored" needs an explicit border treatment on screen;
  // everything else relies on its fill.
  borderClass?: string;
}

// Colour + icon together, always -- never colour alone (WCAG + the
// brief's explicit requirement). Order below is the encoding order used
// everywhere a domain's counts are broken into ordered segments.
export const AFLS_BADGES: Record<AflsBadgeValue, AflsBadgeConfig> = {
  independent: {
    value: "independent",
    label: "Independent",
    icon: "✓",
    bgClass: "bg-brand-prussian-blue",
    textClass: "text-white",
    svgFillClass: "fill-brand-prussian-blue",
    svgTextClass: "fill-white",
  },
  assisted: {
    value: "assisted",
    label: "With assistance",
    icon: "+",
    bgClass: "bg-brand-pastel-blue",
    textClass: "text-brand-prussian-blue",
    svgFillClass: "fill-brand-pastel-blue",
    svgTextClass: "fill-brand-prussian-blue",
  },
  unable: {
    value: "unable",
    label: "Unable",
    icon: "-",
    bgClass: "bg-brand-golden-brown",
    textClass: "text-white",
    svgFillClass: "fill-brand-golden-brown",
    svgTextClass: "fill-white",
  },
  na: {
    value: "na",
    label: "N/A",
    icon: "Ø", // Ø
    bgClass: "bg-brand-off-white",
    textClass: "text-brand-neutral-black",
    svgFillClass: "fill-brand-off-white",
    svgTextClass: "fill-brand-neutral-black",
  },
  unscored: {
    value: "unscored",
    label: "Unscored",
    icon: "?",
    bgClass: "bg-transparent",
    textClass: "text-brand-neutral-black/40",
    svgFillClass: "fill-white",
    svgTextClass: "fill-brand-neutral-black/40",
    borderClass: "border border-dashed border-brand-neutral-black/20",
  },
};

export const AFLS_BADGE_ORDER: AflsBadgeValue[] = ["independent", "assisted", "unable", "na", "unscored"];

// SCORED-only order (excludes "unscored") -- used for stacked-bar
// segments and honeycomb fills, where "unscored" is always handled as
// its own distinct remainder/dashed treatment rather than just another
// segment in the sequence.
const SCORED_ORDER: AflsScoreValue[] = ["independent", "assisted", "unable", "na"];

export interface DomainTally {
  domain: string;
  total: number;
  counts: Record<AflsBadgeValue, number>;
  isFullyUnscored: boolean;
  isPartial: boolean;
}

export function tallyDomain(domain: string, items: InstrumentItem[], scores: AflsItemScore[]): DomainTally {
  const scoreByItemId = new Map(scores.map((s) => [s.itemId, s.score]));
  const counts: Record<AflsBadgeValue, number> = {
    independent: 0,
    assisted: 0,
    unable: 0,
    na: 0,
    unscored: 0,
  };
  for (const item of items) {
    const score = scoreByItemId.get(item.id);
    if (score) counts[score] += 1;
    else counts.unscored += 1;
  }
  const total = items.length;
  return {
    domain,
    total,
    counts,
    isFullyUnscored: total > 0 && counts.unscored === total,
    isPartial: counts.unscored > 0 && counts.unscored < total,
  };
}

export function scoreForItem(scores: AflsItemScore[], itemId: string): AflsBadgeValue {
  return scores.find((s) => s.itemId === itemId)?.score ?? "unscored";
}

// "✓ 6 · + 2 · − 1 · Ø 1" -- zero-count categories are omitted so a
// mostly-independent domain doesn't read as cluttered.
export function formatMicroSummary(tally: DomainTally): string {
  return AFLS_BADGE_ORDER.filter((v) => tally.counts[v] > 0)
    .map((v) => `${AFLS_BADGES[v].icon} ${tally.counts[v]}`)
    .join(" · ");
}

export { SCORED_ORDER as AFLS_SCORED_ORDER };

// True only when NOTHING has been scored anywhere and there's no
// narrative either -- the brief's "zero AFLS data" edge case, which
// keeps the section's existing plain empty state rather than rendering
// an elaborate visual full of "unscored" badges.
export function isAflsResultsEmpty(scoresData: Record<string, AflsItemScore[]>, summary: string | null): boolean {
  const hasAnyScore = Object.values(scoresData).some((arr) => (arr?.length ?? 0) > 0);
  return !hasAnyScore && !summary?.trim();
}
