import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFreebusy } from "@/lib/google/freebusy";
import { computeAvailableSlots, type BookableSessionType } from "@/lib/scheduling/availability";

// PRD 9, Stage 1 -- the parent-facing availability read. Booking
// itself (the actual row+event creation) is Stage 2 and does not exist
// yet; this route only answers "what's free". A Next.js route, not a
// plain Supabase RPC, because computing availability needs an outbound
// call to Google (Freebusy) that a Postgres function can't make --
// get_bookable_clinician_details() does the authorization and settings
// lookup entirely inside Postgres first, so this route never queries
// application tables directly with anything but the caller's own
// already-scoped RPC result.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const passportId = searchParams.get("passportId");
  const clinicianId = searchParams.get("clinicianId");
  const sessionType = searchParams.get("sessionType");

  if (!passportId || !clinicianId || !sessionType) {
    return NextResponse.json({ error: "passportId, clinicianId, and sessionType are all required." }, { status: 400 });
  }

  // school_observation exists in the model (a clinician can record one)
  // but is deliberately never offered to parents (PRD 9 section 3a) --
  // refused here at the boundary, not just left out of the UI, so a
  // crafted request can't reach it either.
  if (sessionType !== "online" && sessionType !== "in_person") {
    return NextResponse.json({ error: "This session type isn't available to book here." }, { status: 400 });
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
    sessionType: sessionType as BookableSessionType,
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
    // Stage 2's own consent step needs these to show the parent what
    // they're agreeing to -- returned here rather than a second round
    // trip back through get_bookable_clinician_details(), since this
    // route already has the same result in hand.
    cancellationNoticeHours: details.cancellation_notice_hours ?? 24,
    cancellationPolicyText: details.cancellation_policy_text ?? null,
  });
}
