// Real page counts for sections A-D, all now built. If further sections
// are added beyond D, add them here too — every page's percentage
// recalculates from this single source, so this is the only place that
// needs updating.
const SECTION_PAGE_COUNTS = {
  a: 1,
  b: 3,
  c: 1,
  d: 4,
} as const;

const TOTAL_PAGES =
  SECTION_PAGE_COUNTS.a +
  SECTION_PAGE_COUNTS.b +
  SECTION_PAGE_COUNTS.c +
  SECTION_PAGE_COUNTS.d;

// pagesCompletedSoFar counts the current page itself as "reached" — e.g.
// section A is page 1 of 6, section B step 2 is page 3 of 6.
export function getPassportProgressPercent(pagesCompletedSoFar: number): number {
  return Math.round((pagesCompletedSoFar / TOTAL_PAGES) * 100);
}
