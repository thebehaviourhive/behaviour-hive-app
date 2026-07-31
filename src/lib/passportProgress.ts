// Sections C and D haven't been built yet, so their real page counts are
// unknown — assumed at 1 page each (matching section A's shape) so the
// overall progress bar has a concrete total to work against today. Update
// these two values once those sections exist; every page's percentage
// recalculates from this single source.
const SECTION_PAGE_COUNTS = {
  a: 1,
  b: 3,
  c: 1,
  d: 1,
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
