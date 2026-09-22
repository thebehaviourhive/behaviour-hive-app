import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCalendarEvent, deleteCalendarEvent, getCalendarEvent } from "@/lib/google/calendarEvents";

// PRD 9, section 7 -- the clinician's own four resolution actions,
// reusing createCalendarEvent()/deleteCalendarEvent() throughout
// rather than adding a new PATCH-based "update event" primitive:
// "revert" and "restore" are both, at the Google layer, delete-if-
// present-then-recreate-at-the-original-time -- the identical
// operation whether the main event merely moved or was deleted
// outright, which is exactly why migration 0284 merged their own DB
// side into one resolve_booking_restore_original() function.
// "reschedule" touches no Google call for the main event at all (it's
// already at the right time -- that's what accepting the drift means);
// only travel-block events (if the booking has any) get repositioned,
// since the clinician only ever dragged the main block. "confirm"
// mirrors cancel_booking()'s own route exactly -- the database is
// authoritative the moment the RPC returns, Google-side cleanup is
// best-effort after.
//
// SCOPE (matching migration 0284's own header): travel-block events
// are never independently checked for drift or deletion -- "revert"
// and "restore" leave them exactly as stored, untouched.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { bookingId, action } = body as { bookingId?: string; action?: string };
  if (!bookingId || !action || !["reschedule", "revert", "confirm", "restore"].includes(action)) {
    return NextResponse.json({ error: "bookingId and a valid action are required." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select(
      "id, passport_id, google_calendar_id, google_event_id, session_start_at, session_end_at, travel_before_start_at, travel_after_end_at, travel_before_event_id, travel_after_event_id, session_type_mode, google_sync_status"
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError || !booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  // Reads the STORED reference (migration 0289) -- the single source of
  // truth every display site also reads, so a recreated event and the
  // app can never disagree.
  const { data: passportRow, error: passportRowError } = await supabase
    .from("passports")
    .select("passport_reference")
    .eq("id", booking.passport_id)
    .single();
  if (passportRowError || !passportRow?.passport_reference) {
    return NextResponse.json({ error: "Couldn't resolve this child's passport reference." }, { status: 500 });
  }
  const summary = `Clinical Session - ${passportRow.passport_reference}`;
  const isOnline = booking.session_type_mode === "online";

  try {
    if (action === "revert" || action === "restore") {
      if (booking.google_event_id) {
        await deleteCalendarEvent(booking.google_calendar_id, booking.google_event_id).catch(() => {});
      }
      const fresh = await createCalendarEvent({
        workspaceEmail: booking.google_calendar_id,
        summary,
        startISO: booking.session_start_at,
        endISO: booking.session_end_at,
        attendeeEmail: user.email ?? undefined,
        withMeetLink: isOnline,
        privateProperties: { passport_id: booking.passport_id, booking_id: booking.id },
      });

      const { error } = await supabase.rpc("resolve_booking_restore_original", {
        p_booking_id: bookingId,
        p_google_event_id: fresh.id,
        p_travel_before_event_id: booking.travel_before_event_id,
        p_travel_after_event_id: booking.travel_after_event_id,
        p_google_meet_link: fresh.meetLink ?? null,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ resolved: true, action });
    }

    if (action === "reschedule") {
      // The main event is already correct on Google -- no call needed
      // for it. Only travel blocks (if any) get repositioned, keeping
      // the ORIGINAL travel duration on each side of the new time.
      let newTravelBeforeStart: string | null = null;
      let newTravelAfterEnd: string | null = null;
      let newTravelBeforeEventId: string | null = null;
      let newTravelAfterEventId: string | null = null;

      const hasTravel = Boolean(booking.travel_before_event_id || booking.travel_after_event_id);
      if (hasTravel) {
        // Refetch the live event to get the actual drifted times -- the
        // detector marked this row 'drifted' at a moment that may not
        // be now; resolving must act on Google's CURRENT truth, not a
        // stale snapshot.
        const lookup = await getCalendarEvent(booking.google_calendar_id, booking.google_event_id as string);
        if (!lookup.found || !lookup.event.startISO || !lookup.event.endISO) {
          return NextResponse.json({ error: "Couldn't confirm the current time on Google. Please try again." }, { status: 502 });
        }
        const newStart = new Date(lookup.event.startISO);
        const newEnd = new Date(lookup.event.endISO);

        if (booking.travel_before_event_id) {
          const beforeDurationMs = new Date(booking.session_start_at).getTime() - new Date(booking.travel_before_start_at!).getTime();
          const travelStart = new Date(newStart.getTime() - beforeDurationMs);
          await deleteCalendarEvent(booking.google_calendar_id, booking.travel_before_event_id).catch(() => {});
          const created = await createCalendarEvent({
            workspaceEmail: booking.google_calendar_id,
            summary: "Travel time",
            startISO: travelStart.toISOString(),
            endISO: newStart.toISOString(),
          });
          newTravelBeforeStart = travelStart.toISOString();
          newTravelBeforeEventId = created.id;
        }
        if (booking.travel_after_event_id) {
          const afterDurationMs = new Date(booking.travel_after_end_at!).getTime() - new Date(booking.session_end_at).getTime();
          const travelEnd = new Date(newEnd.getTime() + afterDurationMs);
          await deleteCalendarEvent(booking.google_calendar_id, booking.travel_after_event_id).catch(() => {});
          const created = await createCalendarEvent({
            workspaceEmail: booking.google_calendar_id,
            summary: "Travel time",
            startISO: newEnd.toISOString(),
            endISO: travelEnd.toISOString(),
          });
          newTravelAfterEnd = travelEnd.toISOString();
          newTravelAfterEventId = created.id;
        }

        const { error } = await supabase.rpc("resolve_booking_reschedule", {
          p_booking_id: bookingId,
          p_new_session_start_at: newStart.toISOString(),
          p_new_session_end_at: newEnd.toISOString(),
          p_new_travel_before_start_at: newTravelBeforeStart,
          p_new_travel_after_end_at: newTravelAfterEnd,
          p_new_travel_before_event_id: newTravelBeforeEventId,
          p_new_travel_after_event_id: newTravelAfterEventId,
        });
        if (error) throw new Error(error.message);
        return NextResponse.json({ resolved: true, action });
      }

      // No travel blocks (online, or a type with none configured) --
      // just adopt whatever Google currently shows.
      const lookup = await getCalendarEvent(booking.google_calendar_id, booking.google_event_id as string);
      if (!lookup.found || !lookup.event.startISO || !lookup.event.endISO) {
        return NextResponse.json({ error: "Couldn't confirm the current time on Google. Please try again." }, { status: 502 });
      }
      const { error } = await supabase.rpc("resolve_booking_reschedule", {
        p_booking_id: bookingId,
        p_new_session_start_at: lookup.event.startISO,
        p_new_session_end_at: lookup.event.endISO,
        p_new_travel_before_start_at: null,
        p_new_travel_after_end_at: null,
        p_new_travel_before_event_id: null,
        p_new_travel_after_event_id: null,
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ resolved: true, action });
    }

    // action === "confirm" -- accept the deletion, cancel properly.
    const { data: cancelResult, error: cancelError } = await supabase.rpc("resolve_booking_confirm_deletion", {
      p_booking_id: bookingId,
    });
    if (cancelError) throw new Error(cancelError.message);
    const row = cancelResult?.[0];
    if (row) {
      const remainingEventIds = [row.travel_before_event_id, row.travel_after_event_id].filter(
        (id): id is string => !!id
      );
      for (const eventId of remainingEventIds) {
        await deleteCalendarEvent(row.google_calendar_id, eventId).catch(() => {});
      }
    }
    return NextResponse.json({ resolved: true, action });
  } catch (err) {
    console.error(`resolve-sync-issue (${action}) failed for booking ${bookingId}:`, err);
    return NextResponse.json({ error: "Something went wrong resolving this. Please try again." }, { status: 500 });
  }
}
