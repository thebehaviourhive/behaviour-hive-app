// Bug 3 (original 5-bug list) fixed the cancellation policy rendering
// twice; the "48hours'" missing-space issue it named as a small extra
// fix was bundled into the SAME generated sentence -- but that
// sentence was hand-typed independently at TWO call sites (the consent
// screen and the Booked screen's own "Need to cancel?" section), which
// is exactly how a fix in one place stops covering the other. One
// function, the actual number+unit fragment, so there is only ever one
// place this can be typed wrong.
export function formatNoticePeriod(hours: number): string {
  return `${hours} hours' notice`;
}
