import { CALENDAR_SCOPE, getImpersonatedAccessToken } from "./serviceAccount";

export interface BusyInterval {
  start: string; // ISO 8601, as returned by Google
  end: string;
}

// Impersonates the CLINICIAN BEING CHECKED, not a fixed "scheduling"
// identity, and asks only for their own calendar -- one call per
// clinician, never a single batched freebusy.query across several
// calendars. Google's freebusy.query supports up to 50 calendar ids in
// one request, which looks like the efficient choice for a
// multidisciplinary child (a BCBA and an SLT), but the result for each
// listed calendar is bounded by the IMPERSONATED CALLER's own
// visibility into it -- which depends on the domain's own
// calendar-sharing defaults, something a future Workspace admin policy
// change could narrow with no warning to this app. A user's freebusy
// visibility into their OWN calendar is guaranteed by Google
// regardless of any sharing setting -- impersonating each clinician to
// check themselves sidesteps the dependency entirely, at the cost of
// one extra HTTP call per additional clinician on a child's team,
// which is still trivially cheap against PRD 9's own stated quota.
export async function getFreebusy(workspaceEmail: string, timeMinISO: string, timeMaxISO: string): Promise<BusyInterval[]> {
  const accessToken = await getImpersonatedAccessToken(workspaceEmail, CALENDAR_SCOPE);

  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      items: [{ id: workspaceEmail }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Freebusy query failed for ${workspaceEmail} (${response.status}): ${body || "no response body"}`);
  }

  const data = (await response.json()) as {
    calendars?: Record<string, { busy?: BusyInterval[]; errors?: { reason: string }[] }>;
  };

  const calendar = data.calendars?.[workspaceEmail];
  if (calendar?.errors?.length) {
    throw new Error(`Freebusy error for ${workspaceEmail}: ${calendar.errors.map((e) => e.reason).join(", ")}`);
  }

  return calendar?.busy ?? [];
}
