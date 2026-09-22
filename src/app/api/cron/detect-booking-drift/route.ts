import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCalendarEvent } from "@/lib/google/calendarEvents";

// PRD 9, section 7 -- the sync/poll mechanism. For every booking this
// app believes is genuinely synced with Google, re-fetch the real
// event and compare. Never adopts a moved time and never auto-cancels
// a deletion (Daniel's own instruction, PRD 9 Stage 1) -- this route
// only marks the two new distinct statuses (Decision 1: 'drifted' for
// a moved event, 'deleted_in_google' for one that's gone), which is
// what actually puts a booking in front of the clinician via
// get_my_bookings_needing_attention(). A human resolves it from there
// -- reschedule or revert; confirm or restore -- never this route.
//
// Only re-checks bookings already believed 'synced' -- a 'pending' or
// 'sync_failed' row was never confirmed to match Google in the first
// place, so "did it drift from a state we never actually verified"
// isn't a question this route can meaningfully answer; an already-
// 'drifted'/'deleted_in_google' row is unresolved, not something to
// re-detect (re-checking it wouldn't change the correct action, which
// is still "wait for the clinician"). Bounded to session_end_at > now()
// -- a booking whose time has already passed can't still be drifting
// forward from this point on; that's a scope decision about WHICH
// bookings are worth re-verifying, not the queue's own filter (which,
// per Decision 2, is resolved-based, never time-based, once something
// IS flagged).
//
// SCOPE: only the booking's own MAIN session event (google_event_id)
// is checked -- never travel-block events. A real, separate question,
// not attempted here (see migration 0284's own header).
//
// Wired into vercel.json at "0 5 * * *" -- once a day, the Hobby
// plan's own hard cap (matching fail-stale-bookings/sweep-discharged-
// bookings). THE REAL CONSEQUENCE, stated plainly per Daniel's own
// instruction: this catches DRIFT, not SAME-DAY changes. A clinician
// deleting a 2pm session at 10am that same day is not caught until
// tomorrow morning's run -- after the parent may already have turned
// up. Upgrading to Pro is what unlocks tighter, same-day detection;
// staying on Hobby means this is a known, accepted limit, not a bug.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: bookings, error: fetchError } = await admin
    .from("bookings")
    .select("id, google_calendar_id, google_event_id, session_start_at, session_end_at")
    .is("cancelled_at", null)
    .eq("google_sync_status", "synced")
    .not("google_event_id", "is", null)
    .gt("session_end_at", new Date().toISOString());

  if (fetchError) {
    console.error("detect-booking-drift: could not list bookings to check:", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  let checked = 0;
  let markedDrifted = 0;
  let markedDeleted = 0;
  let skippedOnError = 0;

  for (const booking of bookings ?? []) {
    checked++;
    try {
      const lookup = await getCalendarEvent(booking.google_calendar_id, booking.google_event_id as string);

      if (!lookup.found || lookup.event.status === "cancelled") {
        const { error } = await admin.rpc("mark_booking_deleted_in_google", { p_booking_id: booking.id });
        if (error) throw error;
        markedDeleted++;
        continue;
      }

      const observedStart = lookup.event.startISO ? new Date(lookup.event.startISO).getTime() : null;
      const observedEnd = lookup.event.endISO ? new Date(lookup.event.endISO).getTime() : null;
      const storedStart = new Date(booking.session_start_at).getTime();
      const storedEnd = new Date(booking.session_end_at).getTime();

      if (observedStart !== storedStart || observedEnd !== storedEnd) {
        const { error } = await admin.rpc("mark_booking_drifted", { p_booking_id: booking.id });
        if (error) throw error;
        markedDrifted++;
      }
    } catch (err) {
      // A genuine failure (network, auth, quota) -- never read as
      // deletion. Skip and let tomorrow's run try again; this
      // booking's own google_sync_status stays 'synced' in the
      // meantime, which is honest (we don't actually know it drifted).
      console.error(`detect-booking-drift: could not check booking ${booking.id}:`, err);
      skippedOnError++;
    }
  }

  return NextResponse.json({ checked, markedDrifted, markedDeleted, skippedOnError });
}
