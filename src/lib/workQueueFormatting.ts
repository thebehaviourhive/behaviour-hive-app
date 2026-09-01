// PRD 4, Stage 2 -- the "time waiting" formatter every WorkQueueRow
// context column uses. New: no elapsed-time formatter existed anywhere
// in this codebase before this stage (checked) -- every existing date
// display is an absolute date/time (formatIncidentDate, formatTimeOfDay),
// never a duration. Deliberately not used for every bucket -- three
// buckets (join requests, unassigned children, no SNA assigned) have no
// timestamp to compute from and render no Context at all rather than a
// wrong or invented one; a fourth (cover expiring today) uses
// formatTimeOfDay() instead, a deadline rather than a wait.
export function formatWaitingSince(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));

  if (minutes < 1) return "Waiting less than a minute";
  if (minutes < 60) return `Waiting ${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Waiting ${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);
  return `Waiting ${days} day${days === 1 ? "" : "s"}`;
}
