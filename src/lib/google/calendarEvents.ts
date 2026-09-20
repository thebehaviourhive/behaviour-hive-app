import { CALENDAR_SCOPE, getImpersonatedAccessToken } from "./serviceAccount";

// PRD 9, Stage 2 -- the write half of the Calendar API, alongside
// freebusy.ts's own read half. Same impersonation shape: the clinician
// being booked, never a shared "scheduling" identity.

export interface CreateEventInput {
  workspaceEmail: string;
  summary: string;
  startISO: string;
  endISO: string;
  // Only the real session event carries an attendee/conference request
  // -- travel-block events are the clinician's own protected time, not
  // a parent-facing meeting, and get neither.
  attendeeEmail?: string;
  withMeetLink?: boolean;
  // extendedProperties.private -- per PRD 9 section 6, this is how a
  // calendar event is matched back to a record. Never put anything
  // identifying the CHILD in here or in `summary` -- passport_id and
  // booking_id are opaque to anyone reading Google's own UI.
  privateProperties?: Record<string, string>;
}

export interface CreatedEvent {
  id: string;
  etag: string;
}

export async function createCalendarEvent(input: CreateEventInput): Promise<CreatedEvent> {
  const accessToken = await getImpersonatedAccessToken(input.workspaceEmail, CALENDAR_SCOPE);

  const body: Record<string, unknown> = {
    summary: input.summary,
    start: { dateTime: input.startISO },
    end: { dateTime: input.endISO },
  };
  if (input.attendeeEmail) {
    body.attendees = [{ email: input.attendeeEmail }];
  }
  if (input.privateProperties) {
    body.extendedProperties = { private: input.privateProperties };
  }
  if (input.withMeetLink) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const url = input.withMeetLink
    ? "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1"
    : "https://www.googleapis.com/calendar/v3/calendars/primary/events";

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Google event creation failed for ${input.workspaceEmail} (${response.status}): ${errorBody || "no response body"}`);
  }

  const data = (await response.json()) as { id?: string; etag?: string };
  if (!data.id) {
    throw new Error(`Google event creation for ${input.workspaceEmail} returned no event id.`);
  }
  return { id: data.id, etag: data.etag ?? "" };
}

// Deliberately tolerant of "already gone" -- a 404/410 here means the
// event doesn't exist, which is exactly the state a delete is trying to
// reach anyway. Anything else (a real failure -- network, auth, quota)
// is a genuine failure the caller must treat as one, since the whole
// point of calling this is to know whether the clinician's real
// calendar now agrees with what our own database says.
export async function deleteCalendarEvent(workspaceEmail: string, eventId: string): Promise<{ ok: boolean; status: number }> {
  const accessToken = await getImpersonatedAccessToken(workspaceEmail, CALENDAR_SCOPE);
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const ok = response.ok || response.status === 404 || response.status === 410;
  return { ok, status: response.status };
}
