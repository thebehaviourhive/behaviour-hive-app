import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFreebusy } from "@/lib/google/freebusy";
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/google/calendarEvents";
import { hasConflict } from "@/lib/scheduling/availability";

// PRD 9, Stage 2 -- the all-or-nothing write. Three real steps, in
// order: (1) a fresh, narrowly-scoped Freebusy re-check against the
// EXACT requested window, never the slot list the parent's page loaded
// minutes ago (PRD section 5's own "first come, first served, confirmed
// at the moment of booking"); (2) the row, written before any Google
// call (create_pending_booking() -- its own EXCLUDE constraint is the
// real, final backstop against a race this re-check might still have
// missed, caught here, before Google is ever touched); (3) the real
// Google event(s) -- travel-before/session/travel-after, one, two, or
// three events depending on what the chosen type's own travel minutes
// call for.
//
// THE HONEST LIMIT ON "ALL-OR-NOTHING": Google's Calendar API has no
// transaction primitive. A best-effort rollback (deleting whatever
// succeeded) can itself fail the same way the original create did --
// pretending otherwise would be worse than the limitation itself. When
// that happens, the booking is marked sync_failed regardless of
// whether the rollback confirmed clean, so it reaches the clinician's
// own get_my_bookings_needing_attention() queue -- a human resolves it,
// the same principle Stage 1 already established for drift. The parent
// gets a plain, synchronous failure message, never a spinner or a
// silent pending state.
//
// Session types, fixed -> clinic-configurable catalogue (migration
// 0281). sessionType (a literal "online"/"in_person" string) is now
// sessionTypeId (a real session_types row's id) -- resolved server-side
// via get_bookable_session_types(), under the same authorization check
// create_pending_booking() itself re-derives independently ("validate
// at write time, don't trust the caller" applies to the calling ROUTE
// just as much as a client UI, since create_pending_booking() is a
// SECURITY DEFINER RPC a crafted request could call directly). Travel-
// block creation is now driven by the TYPE'S OWN travel_before_minutes/
// travel_after_minutes independently (Decision 1 -- never assumed
// symmetric, never derived from location_mode) -- an in-person type's
// seeded 30/30 produces both blocks exactly as before; an online type
// with genuine prep time configured (Decision 2) would produce them
// too, even though it's "online". Only the Meet link is gated on
// location_mode, since that's genuinely what it means (a video call
// link belongs on an online session, never an in-person or elsewhere
// one) -- everything else is driven by the type's own real numbers.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { passportId, clinicianId, sessionTypeId, sessionStartISO, sessionEndISO } = body as {
    passportId?: string;
    clinicianId?: string;
    sessionTypeId?: string;
    sessionStartISO?: string;
    sessionEndISO?: string;
  };

  if (!passportId || !clinicianId || !sessionTypeId || !sessionStartISO || !sessionEndISO) {
    return NextResponse.json(
      { error: "passportId, clinicianId, sessionTypeId, sessionStartISO, and sessionEndISO are all required." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data: details, error: detailsError } = await supabase.rpc("get_bookable_clinician_details", {
    p_passport_id: passportId,
    p_clinician_id: clinicianId,
  });
  if (detailsError || !details) {
    return NextResponse.json({ error: detailsError?.message ?? "Couldn't resolve this clinician." }, { status: 403 });
  }

  const { data: types, error: typesError } = await supabase.rpc("get_bookable_session_types", {
    p_passport_id: passportId,
    p_clinician_id: clinicianId,
  });
  if (typesError) {
    return NextResponse.json({ error: typesError.message }, { status: 403 });
  }
  const sessionType = (
    (types ?? []) as {
      id: string;
      name: string;
      location_mode: string;
      length_minutes: number;
      travel_before_minutes: number;
      travel_after_minutes: number;
    }[]
  ).find((t) => t.id === sessionTypeId);
  if (!sessionType) {
    return NextResponse.json({ error: "This session type isn't available to book here." }, { status: 400 });
  }

  // Bug 2, 22 Sept 2026 -- the availability route already refuses to
  // OFFER a non-working day (Europe/Dublin wall-clock, matching
  // computeAvailableSlots' own convention), but this route never
  // re-checked it -- a crafted POST straight at this endpoint could
  // still book a Saturday. Validated here too, matching this schema's
  // own standing "validate at write time, don't trust the UI" rule
  // (the Freebusy re-check immediately below is the same discipline
  // applied to a different question).
  const workingDays: number[] = details.working_days ?? [1, 2, 3, 4, 5];
  const sessionDayOfWeek = new Date(sessionStartISO).getDay();
  if (!workingDays.includes(sessionDayOfWeek)) {
    return NextResponse.json({ error: "This clinic isn't open on that day. Please choose another slot." }, { status: 400 });
  }

  // Travel bounds computed server-side, never trusted from the client
  // -- each independently either present or absent depending on the
  // chosen type's own configured minutes (Decision 1).
  const sessionStart = new Date(sessionStartISO);
  const sessionEnd = new Date(sessionEndISO);
  const travelBeforeStart =
    sessionType.travel_before_minutes > 0 ? new Date(sessionStart.getTime() - sessionType.travel_before_minutes * 60000) : null;
  const travelAfterEnd =
    sessionType.travel_after_minutes > 0 ? new Date(sessionEnd.getTime() + sessionType.travel_after_minutes * 60000) : null;

  const candidateStart = travelBeforeStart ?? sessionStart;
  const candidateEnd = travelAfterEnd ?? sessionEnd;

  // Step 1: the fresh, narrow re-check.
  let busyIntervals;
  try {
    busyIntervals = await getFreebusy(
      details.workspace_email,
      new Date(candidateStart.getTime() - 60 * 60000).toISOString(),
      new Date(candidateEnd.getTime() + 60 * 60000).toISOString()
    );
  } catch {
    return NextResponse.json({ error: "Couldn't confirm availability right now. Please try again shortly." }, { status: 502 });
  }
  if (hasConflict(busyIntervals, candidateStart.toISOString(), candidateEnd.toISOString(), details.booking_buffer_minutes ?? 15)) {
    return NextResponse.json({ error: "This time is no longer available. Please choose another slot." }, { status: 409 });
  }

  // Step 2: the row, before any Google call.
  const { data: bookingId, error: createError } = await supabase.rpc("create_pending_booking", {
    p_passport_id: passportId,
    p_clinician_id: clinicianId,
    p_session_type_id: sessionTypeId,
    p_session_start_at: sessionStart.toISOString(),
    p_session_end_at: sessionEnd.toISOString(),
    p_travel_before_start_at: travelBeforeStart?.toISOString() ?? null,
    p_travel_after_end_at: travelAfterEnd?.toISOString() ?? null,
    p_google_calendar_id: details.workspace_email,
    p_cancellation_policy_snapshot: details.cancellation_policy_text ?? null,
  });
  if (createError || !bookingId) {
    // The exclude constraint's own violation surfaces here as the exact
    // same friendly message create_pending_booking() raises for it --
    // a race the Freebusy check above missed, caught at the cheapest
    // possible point, before any Google call.
    return NextResponse.json({ error: createError?.message ?? "This time is no longer available. Please choose another slot." }, { status: 409 });
  }

  // Step 3: the real Google event(s). Reads the STORED reference
  // (migration 0289) -- the single source of truth every display site
  // also reads, so a calendar event and the app can never disagree.
  const { data: passportRow, error: passportRowError } = await supabase
    .from("passports")
    .select("passport_reference")
    .eq("id", passportId)
    .single();
  if (passportRowError || !passportRow?.passport_reference) {
    return NextResponse.json({ error: "Couldn't resolve this child's passport reference." }, { status: 500 });
  }
  const passportReference = passportRow.passport_reference;
  const created: { id: string }[] = [];
  let sessionEventId: string | null = null;
  let travelBeforeEventId: string | null = null;
  let travelAfterEventId: string | null = null;
  let etag = "";
  let meetLink: string | null = null;

  try {
    if (travelBeforeStart) {
      const before = await createCalendarEvent({
        workspaceEmail: details.workspace_email,
        summary: "Travel time",
        startISO: travelBeforeStart.toISOString(),
        endISO: sessionStart.toISOString(),
      });
      created.push(before);
      travelBeforeEventId = before.id;
    }

    const session = await createCalendarEvent({
      workspaceEmail: details.workspace_email,
      // The clinician's own calendar title -- distinguishing this
      // client from every other one on a busy calendar is what
      // actually matters here, never the parent's own view (which is
      // entirely this app's own UI, not Google's one shared summary
      // field -- see this route's own header for why PRD section 6's
      // "different title per side" can't be literal on one Google
      // event with one attendee). Deliberately never the type's own
      // NAME (Decision 6) -- a director-authored type name ("ADHD
      // Assessment") on a shared calendar would put a diagnosis on it,
      // exactly what the passport reference convention exists to
      // prevent.
      summary: `Clinical Session - ${passportReference}`,
      startISO: sessionStart.toISOString(),
      endISO: sessionEnd.toISOString(),
      attendeeEmail: user.email,
      withMeetLink: sessionType.location_mode === "online",
      privateProperties: { passport_id: passportId, booking_id: bookingId },
    });
    created.push(session);
    sessionEventId = session.id;
    etag = session.etag;
    meetLink = session.meetLink ?? null;

    if (travelAfterEnd) {
      const after = await createCalendarEvent({
        workspaceEmail: details.workspace_email,
        summary: "Travel time",
        startISO: sessionEnd.toISOString(),
        endISO: travelAfterEnd.toISOString(),
      });
      created.push(after);
      travelAfterEventId = after.id;
    }
  } catch (err) {
    // Best-effort rollback -- delete whatever succeeded. A delete call
    // can itself fail; mark sync_failed regardless of the outcome, per
    // this route's own header.
    for (const event of created) {
      try {
        await deleteCalendarEvent(details.workspace_email, event.id);
      } catch {
        // swallowed deliberately -- sync_failed below is what surfaces
        // this, not a second error path here.
      }
    }
    await supabase.rpc("mark_booking_sync_failed", { p_booking_id: bookingId });
    console.error("Booking creation failed after row insert:", err);
    return NextResponse.json({ error: "Something went wrong completing this booking. Please try again." }, { status: 500 });
  }

  const { error: syncError } = await supabase.rpc("mark_booking_synced", {
    p_booking_id: bookingId,
    p_google_event_id: sessionEventId,
    p_travel_before_event_id: travelBeforeEventId,
    p_travel_after_event_id: travelAfterEventId,
    p_google_etag: etag,
    p_google_meet_link: meetLink,
  });
  if (syncError) {
    console.error("mark_booking_synced failed after a genuinely successful Google write:", syncError);
  }

  return NextResponse.json({
    bookingId,
    clinicianName: details.full_name,
    sessionTypeName: sessionType.name,
    sessionTypeMode: sessionType.location_mode,
    sessionStartISO: sessionStart.toISOString(),
    sessionEndISO: sessionEnd.toISOString(),
    meetLink,
  });
}
