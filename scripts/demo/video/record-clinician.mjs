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
// Recon finding: the clinician passport page (/clinician/passport/
// [id]) supports a one-time ?tab=<key> deep link, read once at mount
// (src/app/clinician/passport/[passportId]/page.tsx) -- confirmed live
// against the deployed app. Using it directly is far more reliable
// than scrolling a horizontally-clipped tab bar to a tab that doesn't
// fit in a 375px viewport, and it's exactly the same mechanism the
// app's own Strategy Insights drill-down already uses to link here.

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
  await beat(9);

  // ---- 10-22: Opens Alfie ----
  await tapWithCursor(page, page.getByRole("link", { name: /Alfie Byrne/i }).first());
  await page.waitForURL(/\/clinician\/passport\//, { timeout: 10000 }).catch(() => {});
  await beat(21);

  // ---- 22-32: SYNC 1 -- same check-in visible on Alfie's record ----
  // Summary tab already shows "Today's Context" once the parent's
  // check-in exists -- a real navigation (not reload) forces the
  // refetch, same reasoning as the other two tracks.
  await page.goto(alfieUrl(), { waitUntil: "domcontentloaded" });
  await humanPause(600);
  await page.getByText(/Today's Context|Regulation:/i).first().scrollIntoViewIfNeeded().catch(() => {});
  await beat(31);

  // ---- 32-48: Holds on Alfie's timeline ----
  await page.goto(alfieUrl("incidents"), { waitUntil: "domcontentloaded" });
  await humanPause(600);
  await beat(47);

  // ---- 48-58: SYNC 2 -- the ABC the teacher just logged appears ----
  // ABCTimeline fetches on mount only (Phase 0 finding) -- re-enter via
  // a real navigation so the just-logged incident is actually there,
  // not assumed.
  await page.goto(alfieUrl(), { waitUntil: "domcontentloaded" });
  await humanPause(300);
  await page.goto(alfieUrl("incidents"), { waitUntil: "domcontentloaded" });
  await humanPause(500);
  await beat(57);

  // ---- 58-72: Opens Effectiveness view ----
  await page.goto(alfieUrl("effectiveness"), { waitUntil: "domcontentloaded" });
  await humanPause(600);
  await beat(71);

  // ---- 72-82: SYNC 3 -- the rating lands in the strategy's effectiveness ----
  await page.goto(alfieUrl(), { waitUntil: "domcontentloaded" });
  await humanPause(300);
  await page.goto(alfieUrl("effectiveness"), { waitUntil: "domcontentloaded" });
  await humanPause(500);
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
