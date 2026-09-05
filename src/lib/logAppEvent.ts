import { createClient } from "@/lib/supabase/client";

// Time-on-task instrumentation, Pass 2 (migration 0174). Fire-and-
// forget, matching logActivity.ts's own established shape exactly: this
// must never surface an error to the caller or block a real action.
// Collected for an internal engagement/adoption report, not surfaced
// anywhere in-product -- see CLAUDE.md's SESSION AND NAVIGATION
// TRACKING entry.

export type AppEventType = "page_view" | "task_started" | "task_cancelled" | "search_performed";

const SESSION_STORAGE_KEY = "bh_session_id";
// UUID-shaped path segments only -- gen_random_uuid() is this schema's
// universal id convention, so this one pattern covers every route in
// the app without a per-route allow-list to maintain.
const UUID_SEGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// One id per browser tab's lifetime -- sessionStorage, not a cookie, no
// cross-device or cross-site correlation possible even in principle.
// Session length is derived at query time as max(created_at) -
// min(created_at) grouped by this value, never stored.
function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private browsing / storage disabled -- a fresh id per call still
    // lets every other event field record correctly, just without
    // session grouping for this visitor. Never the reason a real
    // action fails.
    return crypto.randomUUID();
  }
}

// Strips any resolved record id out of a route before it's ever sent --
// see migration 0174's own header for why this is structural, not a
// style choice. "[id]" not "[incidentId]"/"[passportId]" etc -- this
// function doesn't know which param it's looking at, and doesn't need
// to: the property that matters is that no UUID ever leaves the client.
export function sanitizeRoute(pathname: string): string {
  return pathname.replace(UUID_SEGMENT, "[id]");
}

export function logAppEvent(params: {
  route: string;
  eventType: AppEventType;
  role?: string;
  institutionId?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  try {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!user) return; // logged out -- nothing to attribute this to
      const role = params.role ?? (user.app_metadata?.role as string | undefined) ?? null;
      supabase
        .from("app_events")
        .insert({
          user_id: user.id,
          role,
          institution_id: params.institutionId ?? null,
          session_id: getSessionId(),
          route: sanitizeRoute(params.route),
          event_type: params.eventType,
          metadata: params.metadata ?? null,
        })
        .then(
          () => {},
          () => {}
        );
    }, () => {});
  } catch {
    // Swallow -- instrumentation must never break the action it's
    // attached to, and must never be the one thing that's slow on the
    // 15-second stamp.
  }
}
