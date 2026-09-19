import { addDays, addMinutes, isAfter, isBefore, startOfDay } from "date-fns";
import type { BusyInterval } from "@/lib/google/freebusy";

export type BookableSessionType = "online" | "in_person";

const SESSION_MINUTES = 60;
const TRAVEL_MINUTES = 30;
const SLOT_STEP_MINUTES = 30; // slots offered on a half-hour grid, not only on the hour

export interface AvailabilityInput {
  sessionType: BookableSessionType;
  windowStartISO: string;
  windowEndISO: string;
  clinicHoursStart: string; // "HH:MM:SS" or "HH:MM"
  clinicHoursEnd: string;
  bufferMinutes: number;
  busyIntervals: BusyInterval[];
}

export interface AvailableSlot {
  startISO: string;
  endISO: string;
}

// The type is chosen before availability is shown (PRD 9 section 3a) --
// this is the one function that answers "given that choice, how much
// clear time does a candidate gap actually need". In-person needs a
// full two-hour clear window (30 min travel, 60 min session, 30 min
// travel) to offer a one-hour slot; online needs sixty minutes. Only
// the middle hour is ever offered to a parent as the bookable slot --
// the travel blocks themselves are written to Google at booking time
// (Stage 2), never here; this only needs to know how much clear time
// must exist to safely OFFER one at all.
function requiredClearMinutes(sessionType: BookableSessionType): number {
  return sessionType === "online" ? SESSION_MINUTES : TRAVEL_MINUTES + SESSION_MINUTES + TRAVEL_MINUTES;
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
// between sessions (PRD 9 section 4) -- computed per calendar day
// across the rolling booking window, in Europe/Dublin wall-clock time.
// Hardcoded, not read from any setting: every existing day-scoped
// feature in this schema (temporary_access_start_time/cutoff_time)
// already assumes a single fixed timezone with no column to say so --
// this inherits that assumption rather than deciding it fresh. Revisit
// if this product is ever deployed somewhere else.
export function computeAvailableSlots(input: AvailabilityInput): AvailableSlot[] {
  const { sessionType, busyIntervals, bufferMinutes } = input;
  const windowStart = new Date(input.windowStartISO);
  const windowEnd = new Date(input.windowEndISO);
  const clearMinutes = requiredClearMinutes(sessionType);
  const travelMinutes = sessionType === "online" ? 0 : TRAVEL_MINUTES;

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
    const dayClinicStart = atTimeOfDay(day, clinicStart);
    const dayClinicEnd = atTimeOfDay(day, clinicEnd);
    const dayStart = dayClinicStart > windowStart ? dayClinicStart : windowStart;
    const dayEnd = dayClinicEnd < windowEnd ? dayClinicEnd : windowEnd;

    if (isBefore(dayStart, dayEnd)) {
      const dayBusy = paddedBusy.filter((b) => isBefore(b.start, dayEnd) && isAfter(b.end, dayStart));

      let cursor = dayStart;
      for (const busy of dayBusy) {
        const gapEnd = busy.start < dayEnd ? busy.start : dayEnd;
        offerSlotsInGap(cursor, gapEnd, clearMinutes, travelMinutes, slots);
        cursor = busy.end > cursor ? busy.end : cursor;
      }
      offerSlotsInGap(cursor, dayEnd, clearMinutes, travelMinutes, slots);
    }

    day = addDays(day, 1);
  }

  return slots;
}

function offerSlotsInGap(
  gapStart: Date,
  gapEnd: Date,
  clearMinutes: number,
  travelMinutes: number,
  out: AvailableSlot[]
): void {
  let candidateClearStart = gapStart;
  while (!isAfter(addMinutes(candidateClearStart, clearMinutes), gapEnd)) {
    const sessionStart = addMinutes(candidateClearStart, travelMinutes);
    const sessionEnd = addMinutes(sessionStart, SESSION_MINUTES);
    out.push({ startISO: sessionStart.toISOString(), endISO: sessionEnd.toISOString() });
    candidateClearStart = addMinutes(candidateClearStart, SLOT_STEP_MINUTES);
  }
}
