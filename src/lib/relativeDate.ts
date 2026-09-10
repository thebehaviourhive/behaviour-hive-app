// Plain relative "how long ago" for Section E's own last-updated date --
// shared so every staff-facing surface that reads Section E renders it
// the same way. A medical field a parent wrote eighteen months ago and
// never revisited is dangerous in a different way from an empty one, so
// this is always shown, not just on request; a threshold-based visual
// flag (e.g. colouring anything over N months) is a separate, later
// decision, deliberately not built here.
export function formatRelativeDate(value: string | null): string | null {
  if (!value) return null;
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return null;

  const diffMs = Date.now() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 1) return "Updated today";
  if (diffDays === 1) return "Updated yesterday";
  if (diffDays < 30) return `Updated ${diffDays} days ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `Updated ${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;

  const diffYears = Math.floor(diffMonths / 12);
  return `Updated ${diffYears} year${diffYears === 1 ? "" : "s"} ago`;
}
