// CLINICIAN track (Dr. Emma Walsh) -- one leg of the three-track
// backup demo video. Runnable standalone or via record-all.mjs (shared
// t0 -- see record-parent.mjs's header for why that matters).
//
// Corrected beat sheet (Phase 2 review):
//   0-10   Caseload, Alfie's row among others
//   10-22  Opens Alfie
//   22-32  SYNC 1 -- same check-in visible on Alfie's record
//   32-48  Holds on Alfie's timeline
//   48-58  SYNC 2 -- the ABC the teacher just logged appears in
//          Alfie's record
//   58-72  Opens Effectiveness view
//   72-82  SYNC 3 -- the rating lands in the strategy's effectiveness
//   82-90  Trends, full view, holds
//
// Recon findings:
// - The clinician passport page (/clinician/passport/[id]) supports a
//   one-time ?tab=<key> deep link, read once at mount -- confirmed
//   live. Used directly rather than scrolling a horizontally-clipped
//   tab bar to a tab that doesn't fit in a 375px viewport.
// - Take 1 measured beat 31 (SYNC 1) overrunning by ~21s and beat 47 by
//   ~6s. Root cause: SYNC 1 was refreshing via page.goto() to the SAME
//   pathname it had just soft-navigated to moments earlier -- a hard
//   hard hard browser-level reload (full asset re-fetch), where the
//   teacher track's equivalent refresh (a real Back-button tap, then
//   an Alfie-link tap -- both genuine Next.js client-side route
//   changes) had zero overruns. This track now uses that same
//   real-tap pattern (the "‹" button calls router.push, confirmed in
//   src/app/clinician/passport/[passportId]/page.tsx) wherever the
//   target tab doesn't need a query param, and drops the double-goto
//   ("bare URL, THEN tab URL") pattern the earlier version used for
//   tab-specific refreshes down to a single direct goto -- the query
//   string alone is enough to force the right initial tab on a fresh
//   hard navigation; the intermediate bare-URL hop was pure overhead.
// - "Opens Alfie" is also moved from the nominal 10-22s window to ~2s
//   in -- the clinician has nothing else to do across the whole 0-22s
//   span, so there's no reason not to let that one page settle for
//   the full ~20s before SYNC 1 needs it fresh.

import { BASE_URL, makeBeat, tapWithCursor, humanPause, newRecordingContext, runAsChildProcess } from "./lib.mjs";

export const ROLE_KEY = "clinician";
export function warmRoutes(alfiePassportId) {
  return [
    "/clinician/passports",
    `/clinician/passport/${alfiePassportId}`,
    `/clinician/passport/${alfiePassportId}?tab=incidents`,
    `/clinician/passport/${alfiePassportId}?tab=effectiveness`,
    `/clinician/passport/${alfiePassportId}?tab=progress`,
  ];
}

export async function runClinicianTrack({ t0, browser, outDir, overruns, alfiePassportId }) {
  const { context, page } = await newRecordingContext(browser, ROLE_KEY, outDir);
  const beat = makeBeat(t0, "clinician", overruns);
  const alfieUrl = (tab) => `${BASE_URL}/clinician/passport/${alfiePassportId}${tab ? `?tab=${tab}` : ""}`;
  let error = null;

  try {
  // ---- 0-10: Caseload, Alfie's row among others ----
  await page.goto(`${BASE_URL}/clinician/passports`, { waitUntil: "domcontentloaded" });
  await humanPause(1800);

  // "Opens Alfie" moved early -- idle 0-22s otherwise, so do the one
  // thing this track needs done at ~2s and let it fully settle.
  await tapWithCursor(page, page.getByRole("link", { name: /Alfie Byrne/i }).first());
  await page.waitForURL(/\/clinician\/passport\//, { timeout: 10000 }).catch(() => {});
  await beat(9);

  // ---- 10-22: Opens Alfie (already there -- holds) ----
  await beat(21);

  // ---- 22-32: SYNC 1 -- same check-in visible on Alfie's record ----
  // Real client-side navigation (Back -> caseload -> Alfie again), not
  // a hard page.goto() reload -- this is what the teacher track's own
  // zero-overrun refresh already relies on. Forces the same "fetch on
  // mount" remount without paying for a full asset re-fetch.
  await tapWithCursor(page, page.getByRole("button", { name: "Back" }));
  await page.waitForURL(/\/clinician\/passports/, { timeout: 10000 }).catch(() => {});
  await humanPause(300);
  await tapWithCursor(page, page.getByRole("link", { name: /Alfie Byrne/i }).first());
  await page.waitForURL(/\/clinician\/passport\//, { timeout: 10000 }).catch(() => {});
  await page.getByText(/Today's Context|Regulation:/i).first().scrollIntoViewIfNeeded().catch(() => {});
  await beat(31);

  // ---- 32-48: Holds on Alfie's timeline ----
  // Single direct goto to the tab URL, started immediately -- the
  // earlier "bare URL, then tab URL" double-hop was pure overhead; one
  // hard navigation already forces a fresh mount that reads ?tab=
  // correctly on its own.
  await page.goto(alfieUrl("incidents"), { waitUntil: "domcontentloaded" });
  await humanPause(600);
  await beat(47);

  // ---- 48-58: SYNC 2 -- the ABC the teacher just logged appears ----
  // Started right at this window's own opening rather than waiting --
  // the teacher's hero-beat ABC save lands sometime during 32-48, so
  // this is as early as the fresh data could possibly be there.
  await page.goto(alfieUrl("incidents"), { waitUntil: "domcontentloaded" });
  await humanPause(500);
  await beat(57);

  // ---- 58-72: Opens Effectiveness view ----
  await page.goto(alfieUrl("effectiveness"), { waitUntil: "domcontentloaded" });
  await humanPause(600);
  await beat(71);

  // ---- 72-82: SYNC 3 -- the rating lands in the strategy's effectiveness ----
  await page.goto(alfieUrl("effectiveness"), { waitUntil: "domcontentloaded" });
  await humanPause(400);
  const ratedStrategy = page.getByText(/Give a 2-minute transition warning/i).first();
  if (await ratedStrategy.isVisible({ timeout: 2000 }).catch(() => false)) {
    await ratedStrategy.scrollIntoViewIfNeeded().catch(() => {});
  }
  await beat(81);

  // ---- 82-90: Trends, full view, holds ----
  await page.goto(alfieUrl("progress"), { waitUntil: "domcontentloaded" });
  await beat(89.5);
  } catch (err) {
    // Caught here, not left to propagate: the video must still be
    // finalised below even when a beat fails, so a partial recording
    // is available for diagnosis instead of nothing at all.
    error = err;
  }

  const video = page.video();
  await context.close();
  const videoPath = video ? await video.path() : null;

  if (error) throw Object.assign(error, { videoPath });
  return videoPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // alfiePassportId normally arrives via DEMO_VIDEO_ALFIE_ID (set by
  // record-all.mjs); for a standalone solo run, fall back to reading
  // it straight from the credentials file.
  if (!process.env.DEMO_VIDEO_ALFIE_ID) {
    const { readFileSync } = await import("node:fs");
    const creds = JSON.parse(readFileSync(new URL("../.demo-credentials.json", import.meta.url)));
    process.env.DEMO_VIDEO_ALFIE_ID = creds.parentHero.passportId;
  }
  await runAsChildProcess(ROLE_KEY, warmRoutes, runClinicianTrack);
}
