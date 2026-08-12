// Local-calendar-date helpers shared across the Progress feature. Same
// local-date derivation rule as useDailyPatterns.ts's toLocalDateString
// (a naive UTC slice lands on the wrong day between local midnight and
// ~1am during BST) -- duplicated here rather than imported since that
// one lives in a hook file, not a pure-logic module.

export function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isoToLocalDateString(iso: string): string {
  return toLocalDateString(new Date(iso));
}

export function todayLocalDateString(): string {
  return toLocalDateString(new Date());
}

// Pure date-string arithmetic, deliberately not using Date math directly
// on the caller's side -- every function here takes/returns "yyyy-mm-dd"
// so nothing upstream has to reason about timezones itself.
export function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toLocalDateString(d);
}

export function daysBetweenInclusive(start: string, end: string): number {
  const startMs = new Date(`${start}T00:00:00`).getTime();
  const endMs = new Date(`${end}T00:00:00`).getTime();
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

// Mirrors dailyPatterns.ts's enumerateDates exactly -- kept as its own
// copy here since that file is itself explicitly one of several
// independent copies of this exact logic (see its own header comment),
// and Progress is a genuinely separate surface.
export function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  while (cur <= endDate) {
    dates.push(toLocalDateString(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// 0 = Sunday .. 6 = Saturday, matching Date#getDay().
export function weekdayIndex(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getDay();
}

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
