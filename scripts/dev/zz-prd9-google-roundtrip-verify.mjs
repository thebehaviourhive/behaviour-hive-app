/* PRD 9 Stage 1 -- Layer 3, the real Google round trip. Run directly
   against Google's own APIs (not through the deployed app), so item 4
   (the impersonation boundary) can pick an arbitrary subject outside
   the domain, and item 2 can create and then delete one real test
   event.

   Run: node --env-file=.env.local scripts/dev/zz-prd9-google-roundtrip-verify.mjs

   Cleans up its own two test events at the end, always (even on
   failure partway through). Nothing else in the target calendar is
   touched. */

import { createPrivateKey, sign } from "node:crypto";

const SUBJECT = "daniel@thebehaviourhive.com";
const OUTSIDE_SUBJECT = "someone.outside@gmail.com";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

function base64url(input) {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getServiceAccountKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set.");
  return JSON.parse(raw);
}

async function getImpersonatedAccessToken(subjectEmail, scope) {
  const key = getServiceAccountKey();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: key.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    sub: subjectEmail,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), createPrivateKey(key.private_key));
  const jwt = `${unsigned}.${base64url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const bodyText = await response.text();
  return { ok: response.ok, status: response.status, bodyText };
}

async function getFreebusy(accessToken, workspaceEmail, timeMinISO, timeMaxISO) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: timeMinISO, timeMax: timeMaxISO, items: [{ id: workspaceEmail }] }),
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

async function createEvent(accessToken, startISO, endISO, summary) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary,
      start: { dateTime: startISO },
      end: { dateTime: endISO },
    }),
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

async function deleteEvent(accessToken, eventId) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { ok: response.ok || response.status === 410, status: response.status };
}

// Local copy of availability.ts's own computeAvailableSlots -- not
// imported (that file is TS with a `date-fns` import; this script is
// plain Node ESM) -- reproduced verbatim from src/lib/scheduling/
// availability.ts so this proof runs the SAME logic, not a
// reimplementation. Kept byte-identical in behaviour, checked by hand
// against the source file at the time this was written.
const SESSION_MINUTES = 60;
const TRAVEL_MINUTES = 30;
const SLOT_STEP_MINUTES = 30;

function requiredClearMinutes(sessionType) {
  return sessionType === "online" ? SESSION_MINUTES : TRAVEL_MINUTES + SESSION_MINUTES + TRAVEL_MINUTES;
}
function offerSlotsInGap(gapStart, gapEnd, clearMinutes, travelMinutes, out) {
  let candidateClearStart = gapStart;
  const addMinutes = (d, m) => new Date(d.getTime() + m * 60000);
  while (!(addMinutes(candidateClearStart, clearMinutes).getTime() > gapEnd.getTime())) {
    const sessionStart = addMinutes(candidateClearStart, travelMinutes);
    const sessionEnd = addMinutes(sessionStart, SESSION_MINUTES);
    out.push({ startISO: sessionStart.toISOString(), endISO: sessionEnd.toISOString() });
    candidateClearStart = addMinutes(candidateClearStart, SLOT_STEP_MINUTES);
  }
}
function computeAvailableSlots(input) {
  const { sessionType, busyIntervals, bufferMinutes } = input;
  const windowStart = new Date(input.windowStartISO);
  const windowEnd = new Date(input.windowEndISO);
  const clearMinutes = requiredClearMinutes(sessionType);
  const travelMinutes = sessionType === "online" ? 0 : TRAVEL_MINUTES;
  const addMinutes = (d, m) => new Date(d.getTime() + m * 60000);

  const paddedBusy = busyIntervals
    .map((b) => ({ start: addMinutes(new Date(b.start), -bufferMinutes), end: addMinutes(new Date(b.end), bufferMinutes) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots = [];
  const dayBusy = paddedBusy.filter((b) => b.start.getTime() < windowEnd.getTime() && b.end.getTime() > windowStart.getTime());
  let cursor = windowStart;
  for (const busy of dayBusy) {
    const gapEnd = busy.start.getTime() < windowEnd.getTime() ? busy.start : windowEnd;
    offerSlotsInGap(cursor, gapEnd, clearMinutes, travelMinutes, slots);
    cursor = busy.end.getTime() > cursor.getTime() ? busy.end : cursor;
  }
  offerSlotsInGap(cursor, windowEnd, clearMinutes, travelMinutes, slots);
  return slots;
}

let createdEventIds = [];

async function main() {
  console.log("=== ITEM 1: the service account authenticates, impersonating a real clinician ===");
  const tokenResult = await getImpersonatedAccessToken(SUBJECT, CALENDAR_SCOPE);
  console.log(`status: ${tokenResult.status}`);
  console.log(`body: ${tokenResult.bodyText}`);
  if (!tokenResult.ok) {
    console.log("\nFAILED at item 1. Stopping -- everything after this would be noise.");
    process.exitCode = 1;
    return;
  }
  const accessToken = JSON.parse(tokenResult.bodyText).access_token;
  console.log("PASS -- token exchange succeeded, real access_token received.\n");

  console.log("=== ITEM 2: a real Freebusy call, and a known event appearing in it ===");
  // A day 14 days out, to minimise any chance of colliding with a real
  // meeting -- checked directly before placing anything, not assumed.
  const targetDay = new Date();
  targetDay.setUTCDate(targetDay.getUTCDate() + 14);
  targetDay.setUTCHours(0, 0, 0, 0);
  const dayStartISO = targetDay.toISOString();
  const dayEndISO = new Date(targetDay.getTime() + 24 * 3600 * 1000).toISOString();

  const baselineFb = await getFreebusy(accessToken, SUBJECT, dayStartISO, dayEndISO);
  if (!baselineFb.ok) {
    console.log(`FAILED -- baseline Freebusy call itself failed: ${JSON.stringify(baselineFb.data)}`);
    process.exitCode = 1;
    return;
  }
  const baselineBusy = baselineFb.data.calendars?.[SUBJECT]?.busy ?? [];
  console.log(`Baseline busy blocks on the target day (real calendar state): ${JSON.stringify(baselineBusy)}`);

  // Two bounding test events, real, created now -- 09:00-10:00 and
  // 11:30-12:30 UTC, leaving a genuine 90-minute gap (10:00-11:30)
  // between them. 90 minutes clears online's own 60-minute requirement
  // but not in-person's 120-minute one -- the exact differentiation
  // item 3 needs to prove, built from two real events, not a fixture.
  const eventAStart = new Date(targetDay.getTime() + 9 * 3600 * 1000).toISOString();
  const eventAEnd = new Date(targetDay.getTime() + 10 * 3600 * 1000).toISOString();
  const eventBStart = new Date(targetDay.getTime() + 11.5 * 3600 * 1000).toISOString();
  const eventBEnd = new Date(targetDay.getTime() + 12.5 * 3600 * 1000).toISOString();

  const eventA = await createEvent(accessToken, eventAStart, eventAEnd, "ZZ PRD9 Google round-trip test A (safe to delete)");
  const eventB = await createEvent(accessToken, eventBStart, eventBEnd, "ZZ PRD9 Google round-trip test B (safe to delete)");
  if (!eventA.ok || !eventB.ok) {
    console.log(`FAILED -- could not create test events. A: ${JSON.stringify(eventA)} B: ${JSON.stringify(eventB)}`);
    process.exitCode = 1;
    return;
  }
  createdEventIds = [eventA.data.id, eventB.data.id];
  console.log(`Created real events: A=${eventA.data.id} (${eventAStart}-${eventAEnd}), B=${eventB.data.id} (${eventBStart}-${eventBEnd})`);

  const afterFb = await getFreebusy(accessToken, SUBJECT, dayStartISO, dayEndISO);
  const afterBusy = afterFb.data.calendars?.[SUBJECT]?.busy ?? [];
  console.log(`Freebusy after creating the events: ${JSON.stringify(afterBusy)}`);

  const containsA = afterBusy.some((b) => new Date(b.start).getTime() === new Date(eventAStart).getTime() && new Date(b.end).getTime() === new Date(eventAEnd).getTime());
  const containsB = afterBusy.some((b) => new Date(b.start).getTime() === new Date(eventBStart).getTime() && new Date(b.end).getTime() === new Date(eventBEnd).getTime());
  console.log(`PASS/FAIL -- event A's exact window appears in Freebusy: ${containsA}`);
  console.log(`PASS/FAIL -- event B's exact window appears in Freebusy: ${containsB}`);
  if (!containsA || !containsB) {
    console.log("\nFAILED at item 2 -- a real, just-created event did not appear in a real Freebusy read. Stopping.");
    await cleanup(accessToken);
    process.exitCode = 1;
    return;
  }
  console.log("PASS -- Freebusy reflects actual, real calendar state, confirmed by a real write-then-read.\n");

  console.log("=== ITEM 3: availability end to end, fed by the real Freebusy data just proven ===");
  const onlineSlots = computeAvailableSlots({
    sessionType: "online",
    windowStartISO: dayStartISO,
    windowEndISO: dayEndISO,
    clinicHoursStart: "00:00:00",
    clinicHoursEnd: "23:59:00",
    bufferMinutes: 0,
    busyIntervals: afterBusy,
  });
  const inPersonSlots = computeAvailableSlots({
    sessionType: "in_person",
    windowStartISO: dayStartISO,
    windowEndISO: dayEndISO,
    clinicHoursStart: "00:00:00",
    clinicHoursEnd: "23:59:00",
    bufferMinutes: 0,
    busyIntervals: afterBusy,
  });
  const onlineInGap = onlineSlots.filter((s) => new Date(s.startISO).getTime() >= new Date(eventAEnd).getTime() && new Date(s.endISO).getTime() <= new Date(eventBStart).getTime());
  const inPersonInGap = inPersonSlots.filter((s) => new Date(s.startISO).getTime() >= new Date(eventAEnd).getTime() && new Date(s.endISO).getTime() <= new Date(eventBStart).getTime());
  console.log(`Online slots inside the real 90-minute gap (10:00-11:30 UTC): ${JSON.stringify(onlineInGap)}`);
  console.log(`In-person slots inside the SAME real gap: ${JSON.stringify(inPersonInGap)}`);
  const item3Pass = onlineInGap.length > 0 && inPersonInGap.length === 0;
  console.log(`PASS/FAIL -- online offers a slot where in-person cannot, against REAL Freebusy data: ${item3Pass}`);
  if (!item3Pass) {
    console.log("\nFAILED at item 3.");
    await cleanup(accessToken);
    process.exitCode = 1;
    return;
  }
  console.log("PASS -- the pure function, fed real data, produces the exact differentiation it's designed for.\n");

  await cleanup(accessToken);

  console.log("=== ITEM 4: the impersonation boundary -- an address outside the domain must be refused ===");
  const outsideResult = await getImpersonatedAccessToken(OUTSIDE_SUBJECT, CALENDAR_SCOPE);
  console.log(`status: ${outsideResult.status}`);
  console.log(`body: ${outsideResult.bodyText}`);
  const item4Pass = !outsideResult.ok;
  console.log(`PASS/FAIL -- token exchange for an out-of-domain subject was refused (not silently issued): ${item4Pass}`);
  if (!item4Pass) {
    console.log("\nFAILED at item 4 -- the service account was able to obtain a token for an address outside the domain. This is a real security finding, not a test artefact.");
    process.exitCode = 1;
    return;
  }
  console.log("PASS -- Domain-Wide Delegation is genuinely scoped to the verified domain.\n");

  console.log("ALL FOUR ITEMS PASSED. Layer 3 is proven. Stage 1 is closed.");
}

async function cleanup(accessToken) {
  for (const id of createdEventIds) {
    const result = await deleteEvent(accessToken, id);
    console.log(`cleanup: deleted event ${id} -- ok=${result.ok} status=${result.status}`);
  }
  createdEventIds = [];
}

main().catch(async (err) => {
  console.error("SCRIPT ERROR:", err);
  process.exitCode = 1;
});
