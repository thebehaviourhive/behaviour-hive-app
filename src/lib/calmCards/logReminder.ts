// Log-nudge [Not now] path (constraint 3C): a soft dashboard reminder
// card, persisted the exact same way the existing "Passport Completed!"
// card already does (per-user localStorage key, read once on mount) --
// not a new pattern, the same one. Keyed by episode id (not just a
// boolean) so the parent-dashboard/page.tsx effect on /passport/dashboard
// can clear the SAME reminder it created once that specific episode's
// ABC log actually gets completed, distinct from an explicit Dismiss.
const KEY_PREFIX = "calmLogReminder:";

export interface PendingLogReminder {
  episodeId: string;
  createdAt: string;
}

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function setPendingLogReminder(userId: string, episodeId: string): void {
  window.localStorage.setItem(storageKey(userId), JSON.stringify({ episodeId, createdAt: new Date().toISOString() }));
}

export function getPendingLogReminder(userId: string): PendingLogReminder | null {
  const raw = window.localStorage.getItem(storageKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingLogReminder;
  } catch {
    return null;
  }
}

export function clearPendingLogReminder(userId: string): void {
  window.localStorage.removeItem(storageKey(userId));
}
