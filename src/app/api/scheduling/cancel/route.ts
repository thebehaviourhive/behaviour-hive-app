import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteCalendarEvent } from "@/lib/google/calendarEvents";

// PRD 9, Stage 2 -- one shared cancellation path for all three real
// actors (parent, clinician, director), per Daniel's own instruction.
// cancel_booking() itself derives WHO is cancelling from who is
// calling -- this route never sends a claimed role, matching this
// schema's own "never trust a client-supplied via value" discipline.
// Notice-period is a WARNING the client shows before ever calling this
// -- nothing here enforces it; billing is out of scope, so there is
// nothing to gate.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { bookingId, reason } = body as { bookingId?: string; reason?: string };
  if (!bookingId) {
    return NextResponse.json({ error: "bookingId is required." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("cancel_booking", { p_booking_id: bookingId, p_reason: reason ?? null });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  const row = data?.[0];
  if (!row) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  // The database is already authoritative at this point -- the booking
  // IS cancelled. Deleting the real Google event(s) is best-effort
  // cleanup, not something the cancellation itself waits on: a delete
  // failure here doesn't change what happened, it just means the
  // clinician's calendar may not agree yet. Surfaced via the SAME
  // sync_failed mechanism the all-or-nothing write already uses, not a
  // second one.
  const eventIds = [row.google_event_id, row.travel_before_event_id, row.travel_after_event_id].filter(
    (id): id is string => !!id
  );
  let anyDeleteFailed = false;
  for (const eventId of eventIds) {
    try {
      const result = await deleteCalendarEvent(row.google_calendar_id, eventId);
      if (!result.ok) anyDeleteFailed = true;
    } catch {
      anyDeleteFailed = true;
    }
  }
  if (anyDeleteFailed) {
    await supabase.rpc("mark_booking_sync_failed", { p_booking_id: bookingId });
  }

  return NextResponse.json({ cancelled: true });
}
