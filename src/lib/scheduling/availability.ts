import { addDays, addMinutes, isAfter, isBefore, startOfDay } from "date-fns";
import type { BusyInterval } from "@/lib/google/freebusy";

// Session types, fixed -> clinic-configurable catalogue (migration
// 0281). BookableSessionType/getSessionMode() are gone -- there is no
// longer a fixed "online" | "in_person" literal to switch on anywhere
// in this file. A session type is now a real row (session_types),
// resolved server-side per booking/availability request via
// get_bookable_session_types(); its own length_minutes/
// travel_before_minutes/travel_after_minutes ARE the numbers this
// module needs, passed in directly rather than re-derived from a mode
// string. location_mode still exists on the type (online/in_person/
// elsewhere) but this module has no reason to read it -- only the
// booking route does, and only to decide whether to request a Meet
// link, never to decide travel/length.

const SLOT_STEP_MINUTES = 30; // slots offered on a half-hour grid, not only on the hour

export interface AvailabilityInput {
  // The chosen type's own numbers (PRD 9 section 3a -- the type is
  // picked before availability is computed). Independent before/after
  // travel (Decision 1, session-types recon) -- packing up after a
  // home visit genuinely takes longer than setting out, so these are
  // never assumed equal or derived from one another.
  sessionLengthMinutes: number;
  travelBeforeMinutes: number;
  travelAfterMinutes: number;
  windowStartISO: string;
  windowEndISO: string;
  clinicHoursStart: string; // "HH:MM:SS" or "HH:MM"
  clinicHoursEnd: string;
  // Bug 2, 22 Sept 2026 -- clinic hours were a start/end TIME only, no
  // day-of-week concept at all, so every day of the week got identical
  // treatment and Saturday/Sunday slots were offered alongside Monday's.
  // Date.getDay() convention (0=Sunday..6=Saturday), matching
  // institutions.working_days -- both produced and consumed entirely in
  // TypeScript, so no conversion step is needed anywhere. Defaults to
  // Monday-Friday only as a defensive fallback for a caller that
  // doesn't pass one; the real default lives on the institutions column
  // itself (migration 0279).
  workingDays?: number[];
  bufferMinutes: number;
  busyIntervals: BusyInterval[];
}

export interface AvailableSlot {
  startISO: string;
  endISO: string;
}

function parseTimeOfDay(value: string): { hours: number; minutes: number } {
  const [h, m] = value.split(":").map((part) => Number.parseInt(part, 10));
  return { hours: h, minutes: m };
}

function atTimeOfDay(day: Date, timeOfDay: { hours: number; minutes: number }): Date {
  const result = new Date(day);
  result.setHours(timeOfDay.hours, timeOfDay.minutes, 0, 0);
  return result;
}

// Clinic hours minus the clinician's Freebusy blocks, with a buffer
// between sessions (PRD 9 section 4) -- computed per WORKING calendar
// day across the rolling booking window, in Europe/Dublin wall-clock
// time. A non-working day (Saturday/Sunday by default) is skipped
// entirely, not merely offered with zero slots -- see workingDays on
// AvailabilityInput.
// Hardcoded, not read from any setting: every existing day-scoped
// feature in this schema (temporary_access_start_time/cutoff_time)
// already assumes a single fixed timezone with no column to say so --
// this inherits that assumption rather than deciding it fresh. Revisit
// if this product is ever deployed somewhere else.
export function computeAvailableSlots(input: AvailabilityInput): AvailableSlot[] {
  const { sessionLengthMinutes, travelBeforeMinutes, travelAfterMinutes, busyIntervals, bufferMinutes } = input;
  const windowStart = new Date(input.windowStartISO);
  const windowEnd = new Date(input.windowEndISO);
  const workingDays = new Set(input.workingDays ?? [1, 2, 3, 4, 5]);

  const clinicStart = parseTimeOfDay(input.clinicHoursStart);
  const clinicEnd = parseTimeOfDay(input.clinicHoursEnd);

  // The buffer pads EVERY busy interval Freebusy reports, uniformly --
  // not selectively around "our own sessions". Freebusy is deliberately
  // a privacy-preserving primitive: it returns opaque busy/free
  // intervals with no event metadata at all, so there is no way to
  // tell from its response whether a given block is one of this app's
  // own booked sessions or an unrelated personal commitment the
  // clinician blocked directly in Google Calendar. A session-specific
  // buffer is not available without switching to events.list (which
  // exposes full event details, including this app's own
  // extendedProperties tags, but only for events the impersonated
  // clinician can already see) -- not what Stage 1 uses.
  const paddedBusy = busyIntervals
    .map((b) => ({
      start: addMinutes(new Date(b.start), -bufferMinutes),
      end: addMinutes(new Date(b.end), bufferMinutes),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: AvailableSlot[] = [];
  let day = startOfDay(windowStart);
  const lastDay = startOfDay(windowEnd);

  while (!isAfter(day, lastDay)) {
    if (!workingDays.has(day.getDay())) {
      day = addDays(day, 1);
      continue;
    }

    const dayClinicStart = atTimeOfDay(day, clinicStart);
    const dayClinicEnd = atTimeOfDay(day, clinicEnd);
    const dayStart = dayClinicStart > windowStart ? dayClinicStart : windowStart;
    const dayEnd = dayClinicEnd < windowEnd ? dayClinicEnd : windowEnd;

    if (isBefore(dayStart, dayEnd)) {
      const dayBusy = paddedBusy.filter((b) => isBefore(b.start, dayEnd) && isAfter(b.end, dayStart));

      let cursor = dayStart;
      for (const busy of dayBusy) {
        const gapEnd = busy.start < dayEnd ? busy.start : dayEnd;
        offerSlotsInGap(cursor, gapEnd, sessionLengthMinutes, travelBeforeMinutes, travelAfterMinutes, slots);
        cursor = busy.end > cursor ? busy.end : cursor;
      }
      offerSlotsInGap(cursor, dayEnd, sessionLengthMinutes, travelBeforeMinutes, travelAfterMinutes, slots);
    }

    day = addDays(day, 1);
  }

  return slots;
}

// PRD 9, Stage 2 -- the first-come-first-served re-check at the moment
// of booking (PRD section 5) needs the EXACT same "is this candidate
// window clear" logic computeAvailableSlots() already uses internally,
// applied to one specific window instead of scanned across a whole
// rolling range. Same buffer-padding rule (applies to every busy block
// uniformly -- see computeAvailableSlots' own header for why), so a
// slot the parent was just shown as free and a slot the booking route
// re-confirms as free can never quietly disagree because the two used
// different padding.
export function hasConflict(busyIntervals: BusyInterval[], candidateStartISO: string, candidateEndISO: string, bufferMinutes: number): boolean {
  const candidateStart = new Date(candidateStartISO);
  const candidateEnd = new Date(candidateEndISO);
  return busyIntervals.some((b) => {
    const paddedStart = addMinutes(new Date(b.start), -bufferMinutes);
    const paddedEnd = addMinutes(new Date(b.end), bufferMinutes);
    return isBefore(paddedStart, candidateEnd) && isAfter(paddedEnd, candidateStart);
  });
}

// The gap needs enough clear time for travelBefore + the session itself
// + travelAfter, and the session always starts travelBeforeMinutes
// after the candidate clear-window's own start -- independent numbers,
// never assumed symmetric (Decision 1).
function offerSlotsInGap(
  gapStart: Date,
  gapEnd: Date,
  sessionLengthMinutes: number,
  travelBeforeMinutes: number,
  travelAfterMinutes: number,
  out: AvailableSlot[]
): void {
  const clearMinutes = travelBeforeMinutes + sessionLengthMinutes + travelAfterMinutes;
  let candidateClearStart = gapStart;
  while (!isAfter(addMinutes(candidateClearStart, clearMinutes), gapEnd)) {
    const sessionStart = addMinutes(candidateClearStart, travelBeforeMinutes);
    const sessionEnd = addMinutes(sessionStart, sessionLengthMinutes);
    out.push({ startISO: sessionStart.toISOString(), endISO: sessionEnd.toISOString() });
    candidateClearStart = addMinutes(candidateClearStart, SLOT_STEP_MINUTES);
  }
}
