import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteCalendarEvent } from "@/lib/google/calendarEvents";

// PRD 9, Stage 2 -- discharge as a SWEEP, not a client-side cleanup
// step. Daniel's own instruction, and the reason is the record:
// end_clinic_episode() is pure SQL and has no way to reach Google, so a
// client-side step only ever fires for whichever ONE path happens to
// call it. A sweep, same shape as /api/cron/fail-stale-bookings
// (already live), survives every path a discharge can happen through,
// present or future.
//
// sweep_bookings_for_ended_episodes() does the authoritative half
// (cancelling the DB rows, cancelled_via='discharge') and returns what
// this route needs to clean up in Google -- a delete failure here
// doesn't change the cancellation fact, it's surfaced back through
// mark_booking_sync_failed(), the same clinician queue every other
// sync problem already reaches.
//
// NOT yet wired into vercel.json -- same inert-until-activated posture
// as fail-stale-bookings and purge-app-events. To activate: add
// {"path": "/api/cron/sweep-discharged-bookings", "schedule": "0 3 * * *"}
// (once a day is plenty -- a discharge ending up to a day before its
// future bookings are cleaned is a low-stakes delay, not a safety
// issue) and confirm CRON_SECRET is set (already required by the other
// two cron routes, reused here).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: cancelled, error } = await admin.rpc("sweep_bookings_for_ended_episodes");
  if (error) {
    console.error("sweep_bookings_for_ended_episodes failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let googleCleanupFailures = 0;
  for (const row of cancelled ?? []) {
    const eventIds = [row.google_event_id, row.travel_before_event_id, row.travel_after_event_id].filter(
      (id: string | null): id is string => !!id
    );
    let anyFailed = false;
    for (const eventId of eventIds) {
      try {
        const result = await deleteCalendarEvent(row.google_calendar_id, eventId);
        if (!result.ok) anyFailed = true;
      } catch {
        anyFailed = true;
      }
    }
    if (anyFailed) {
      googleCleanupFailures += 1;
      await admin.rpc("mark_booking_sync_failed", { p_booking_id: row.booking_id });
    }
  }

  return NextResponse.json({ success: true, cancelledCount: (cancelled ?? []).length, googleCleanupFailures });
}
