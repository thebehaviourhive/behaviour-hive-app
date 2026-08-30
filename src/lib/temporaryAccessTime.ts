// PRD 1, Stage 3. Client-side mirror of app_local_timezone() (0105) --
// 'Europe/Dublin', the same single, centralised constant, not a
// repeated literal. Used only for DISPLAY and the proactive "access
// ends at..." indicator -- the actual access window is always enforced
// server-side (has_sna_access()'s own live comparison against
// institutions.temporary_access_start_time/temporary_access_cutoff_time);
// nothing here is a security boundary, only a courtesy so the window is
// never a surprise.
//
// PRD 2, Stage 6 follow-up (migration 0133): activation was a fixed
// '07:30' constant everywhere it appeared; it's now a per-institution
// setting the same shape as the cut-off, so every function here that
// used to assume it takes the institution's own current value as a
// parameter instead.

const TIMEZONE = "Europe/Dublin";
// How far ahead of cut-off the indicator switches from informational to
// "finish up soon" -- Daniel's own instruction: a prompt in the last
// stretch, not a change of meaning.
const LATE_WINDOW_MINUTES = 30;

export interface DublinNow {
  date: string; // YYYY-MM-DD
  minutesSinceMidnight: number;
}

export function getDublinNow(): DublinNow {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesSinceMidnight: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function timeStringToMinutes(hhmmss: string): number {
  const [h, m] = hhmmss.split(":").map(Number);
  return h * 60 + m;
}

// Formats a Postgres `time` value ("15:00:00") as "3:00pm" -- matches
// this app's own 12-hour, lowercase-am/pm convention used elsewhere
// (formatDateTime in principal/dashboard, etc.), not re-derived per call
// site. Named generically (not formatCutoffTime) since 0133 made this
// the shared formatter for BOTH the start time and the cut-off, not the
// cut-off alone.
export function formatTimeOfDay(cutoffTime: string): string {
  const minutes = timeStringToMinutes(cutoffTime);
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 < 12 ? "am" : "pm";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0 ? `${hour12}${period}` : `${hour12}:${String(minute).padStart(2, "0")}${period}`;
}

export interface TemporaryAccessWindowStatus {
  isActive: boolean;
  isLate: boolean; // within LATE_WINDOW_MINUTES of cut-off, still active
  minutesRemaining: number | null;
}

// Purely for DISPLAY -- date matching is the caller's job (this only
// answers "given today's grant, where are we in the start-to-cut-off
// window right now"), matching has_sna_access()'s own real check in
// spirit but never used to gate anything itself. startTime/cutoffTime
// are the institution's OWN current values (0133) -- never a fixed
// literal, so a caller with only the cut-off in hand must fetch the
// start time too, the same select it already does for the cut-off.
export function getTemporaryAccessWindowStatus(startTime: string, cutoffTime: string): TemporaryAccessWindowStatus {
  const now = getDublinNow();
  const activationMinutes = timeStringToMinutes(startTime);
  const cutoffMinutes = timeStringToMinutes(cutoffTime);
  const isActive = now.minutesSinceMidnight >= activationMinutes && now.minutesSinceMidnight < cutoffMinutes;
  const minutesRemaining = isActive ? cutoffMinutes - now.minutesSinceMidnight : null;
  return {
    isActive,
    isLate: isActive && minutesRemaining !== null && minutesRemaining <= LATE_WINDOW_MINUTES,
    minutesRemaining,
  };
}

export function todayLocalDateString(): string {
  return getDublinNow().date;
}

// The reactive half of the mid-session design: a specific, honest
// message when a write is refused, on the write paths a temporary-
// access holder actually uses. RLS never tells the client WHY it
// refused, so this deliberately doesn't claim certainty it doesn't
// have -- it names the plausible reason without asserting it as fact,
// the same honesty the ROLE_MISMATCH copy on /principal/dashboard
// already holds to. Callers decide WHEN to show this (typically: the
// write failed AND the current viewer could plausibly be a temporary-
// access holder), not this function.
export function friendlyAccessLapsedMessage(action: string): string {
  return `${action} couldn't be saved. If your access for today has ended, that's why -- otherwise, try again.`;
}
