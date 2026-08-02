import { createClient } from "@/lib/supabase/client";
import type { ActivityEventType } from "@/lib/activityEvents";

// Fire-and-forget: this must never surface an error to the caller, since
// activity logging is a side effect of a real user action (check-in,
// passport save, etc.) that has already succeeded and must not be
// blocked or rolled back by a logging failure.
export function logActivity(params: {
  passportId: string;
  actorId: string;
  eventType: ActivityEventType;
  eventDescription: string;
}): void {
  try {
    const supabase = createClient();
    // supabase-js query builders are lazy thenables — the request is only
    // actually sent once something calls .then()/await on them. A bare
    // `void insert(...)` never does that, so this explicit .then() (with
    // a no-op success/failure handler) is what makes the insert fire at
    // all, while keeping this call non-blocking and silent on failure.
    supabase
      .from("activity_log")
      .insert({
        passport_id: params.passportId,
        actor_id: params.actorId,
        event_type: params.eventType,
        event_description: params.eventDescription,
      })
      .then(
        () => {},
        () => {}
      );
  } catch {
    // Swallow — logging must never break the action it's attached to.
  }
}
