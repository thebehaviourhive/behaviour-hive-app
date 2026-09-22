import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFreebusy } from "@/lib/google/freebusy";
import { computeAvailableSlots } from "@/lib/scheduling/availability";

// PRD 9, Stage 1 -- the parent-facing availability read. Booking
// itself (the actual row+event creation) is Stage 2 and does not exist
// yet; this route only answers "what's free". A Next.js route, not a
// plain Supabase RPC, because computing availability needs an outbound
// call to Google (Freebusy) that a Postgres function can't make --
// get_bookable_clinician_details() does the authorization and settings
// lookup entirely inside Postgres first, so this route never queries
// application tables directly with anything but the caller's own
// already-scoped RPC result.
//
// Session types, fixed -> clinic-configurable catalogue (migration
// 0281) -- sessionType (a literal "online"/"in_person" string) is now
// sessionTypeId (a real session_types row's id). The type's own
// length/travel minutes come from get_bookable_session_types(), the
// same RPC the type-selection screen itself calls to list every
// bookable type -- resolved here by filtering for the one id the
// parent already picked, under the identical authorization check
// (owns_passport + a live institution-engaged clinician_access row),
// never trusted from the query string directly.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const passportId = searchParams.get("passportId");
  const clinicianId = searchParams.get("clinicianId");
  const sessionTypeId = searchParams.get("sessionTypeId");

  if (!passportId || !clinicianId || !sessionTypeId) {
    return NextResponse.json({ error: "passportId, clinicianId, and sessionTypeId are all required." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
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
  const sessionType = ((types ?? []) as { id: string; length_minutes: number; travel_before_minutes: number; travel_after_minutes: number }[]).find(
    (t) => t.id === sessionTypeId
  );
  if (!sessionType) {
    return NextResponse.json({ error: "This session type isn't available to book here." }, { status: 400 });
  }

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + (details.booking_window_days ?? 30));

  let busyIntervals;
  try {
    busyIntervals = await getFreebusy(details.workspace_email, now.toISOString(), windowEnd.toISOString());
  } catch {
    return NextResponse.json(
      { error: "Couldn't check availability right now. Please try again shortly." },
      { status: 502 }
    );
  }

  const slots = computeAvailableSlots({
    sessionLengthMinutes: sessionType.length_minutes,
    travelBeforeMinutes: sessionType.travel_before_minutes,
    travelAfterMinutes: sessionType.travel_after_minutes,
    windowStartISO: now.toISOString(),
    windowEndISO: windowEnd.toISOString(),
    clinicHoursStart: details.clinic_hours_start_time ?? "09:00:00",
    clinicHoursEnd: details.clinic_hours_end_time ?? "17:00:00",
    workingDays: details.working_days ?? [1, 2, 3, 4, 5],
    bufferMinutes: details.booking_buffer_minutes ?? 15,
    busyIntervals,
  });

  return NextResponse.json({
    clinicianName: details.full_name,
    clinicianSpecialty: details.specialty,
    slots,
    // Booking-flow redesign, Sept 2026 -- the day strip (step 3) needs
    // to know the real booking window to correctly bound its own
    // pagination, and the summary card (step 4) needs the institution
    // id to look up the clinic's own address (institutions' SELECT
    // policy is `using (true)`, so the client reads it directly --
    // see BookingSummaryCard.tsx's own caller in book/page.tsx).
    // Returned here rather than a second RPC round trip, since this
    // route already has both values in hand from get_bookable_
    // clinician_details().
    bookingWindowDays: details.booking_window_days ?? 30,
    institutionId: details.institution_id ?? null,
    // Stage 2's own consent step needs these to show the parent what
    // they're agreeing to -- returned here rather than a second round
    // trip back through get_bookable_clinician_details(), since this
    // route already has the same result in hand.
    cancellationNoticeHours: details.cancellation_notice_hours ?? 24,
    cancellationPolicyText: details.cancellation_policy_text ?? null,
  });
}
