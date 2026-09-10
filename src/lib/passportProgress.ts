// Real page counts for sections A-E, all now built. If further sections
// are added beyond E, add them here too — every page's percentage
// recalculates from this single source, so this is the only place that
// needs updating. (e: 1 added for Section E, medical and intimate care
// needs — a single page, same shape as A and C.)
const SECTION_PAGE_COUNTS = {
  a: 1,
  b: 3,
  c: 1,
  d: 4,
  e: 1,
} as const;

const TOTAL_PAGES =
  SECTION_PAGE_COUNTS.a +
  SECTION_PAGE_COUNTS.b +
  SECTION_PAGE_COUNTS.c +
  SECTION_PAGE_COUNTS.d +
  SECTION_PAGE_COUNTS.e;

// pagesCompletedSoFar counts the current page itself as "reached" — e.g.
// section A is page 1 of 6, section B step 2 is page 3 of 6.
export function getPassportProgressPercent(pagesCompletedSoFar: number): number {
  return Math.round((pagesCompletedSoFar / TOTAL_PAGES) * 100);
}
