// PARENT track (Sarah Murphy) -- one leg of the three-track backup
// demo video. Runnable standalone (own t0, for solo debugging) or
// imported by record-all.mjs, which passes a t0 SHARED with the other
// two tracks so beat(n) means the same wall-clock instant everywhere.
//
// Corrected beat sheet (Phase 2 review):
//   0-10   Alfie's dashboard
//   10-22  Morning check-in: regulation, short note, submit
//   22-32  SYNC 1 -- confirmation, back to dashboard
//   32-48  Opens Alfie's passport, holds on strategies
//   48-58  SYNC 2 -- "From your Clinical Team" strategies
//   58-72  Holds on the "Helped N times" counter
//   72-82  SYNC 3 -- "Helped N times" ticks up
//   82-90  Dashboard, calm resting state
//
// All labels below were confirmed against the live deployed app during
// Phase 2 recon, not guessed from source alone.

import { BASE_URL, makeBeat, tapWithCursor, humanPause, newRecordingContext, runAsChildProcess } from "./lib.mjs";

export const ROLE_KEY = "parent";
export function warmRoutes() {
  return ["/parent-dashboard", "/morning-checkin", "/passport/dashboard"];
}

export async function runParentTrack({ t0, browser, outDir, overruns }) {
  const { context, page } = await newRecordingContext(browser, ROLE_KEY, outDir);
  const beat = makeBeat(t0, "parent", overruns);
  let error = null;

  try {
  // ---- 0-10: Alfie's dashboard ----
  await page.goto(`${BASE_URL}/parent-dashboard`, { waitUntil: "domcontentloaded" });
  await beat(9);

  // ---- 10-22: Morning check-in ----
  // No dedicated nav entry visible on this account/state -- deep-linking
  // straight to the flow is just as real a tap-in as a notification or
  // home-screen shortcut would be.
  await page.goto(`${BASE_URL}/morning-checkin`, { waitUntil: "domcontentloaded" });
  await humanPause(500);

  // Step 1 of 4: sleep quality (auto-advances).
  await tapWithCursor(page, page.getByRole("button", { name: /Slept through \/ Well rested/i }));
  await humanPause(600);

  // Step 2 of 4: regulation state (auto-advances).
  await tapWithCursor(page, page.getByRole("button", { name: /Settled and Calm/i }));
  await humanPause(600);

  // Step 3 of 4: stressors -- "No disruptions" bypass chip, then Continue.
  await tapWithCursor(page, page.getByRole("button", { name: /No disruptions/i }));
  await humanPause(400);
  await tapWithCursor(page, page.getByRole("button", { name: "Continue" }));
  await humanPause(500);

  // Step 4 of 4: heads-up note, then submit.
  await page.getByRole("textbox").first().fill("Good morning, a bit excited about the school trip today!");
  await humanPause(400);
  await tapWithCursor(page, page.getByRole("button", { name: /Send to teacher/i }));
  await page.waitForURL(/\/parent-dashboard/, { timeout: 10000 }).catch(() => {});
  await beat(21);

  // ---- 22-32: SYNC 1 -- confirmation, back to dashboard ----
  if (!page.url().includes("/parent-dashboard")) {
    await page.goto(`${BASE_URL}/parent-dashboard`, { waitUntil: "domcontentloaded" });
  }
  await beat(31);

  // ---- 32-48: Opens Alfie's passport, holds on strategies ----
  await page.goto(`${BASE_URL}/passport/dashboard`, { waitUntil: "domcontentloaded" });
  await humanPause(600);
  const clinicalTeamHeading = page.getByText("Your Team", { exact: false }).first();
  await clinicalTeamHeading.scrollIntoViewIfNeeded().catch(() => {});
  await beat(47);

  // ---- 48-58: SYNC 2 -- "From your Clinical Team" strategies ----
  const strategiesLink = page.getByRole("link", { name: /View strategies on Passport/i }).first();
  if (await strategiesLink.isVisible().catch(() => false)) {
    await tapWithCursor(page, strategiesLink);
    await humanPause(600);
  }
  await page.getByText(/Home Strategies|Clinical Team/i).first().scrollIntoViewIfNeeded().catch(() => {});
  await beat(57);

  // ---- 58-72: Holds on the "Helped N times" counter ----
  const helpedBadge = page.getByText(/Helped \d+ time/i).first();
  await helpedBadge.scrollIntoViewIfNeeded().catch(() => {});
  await beat(71);

  // ---- 72-82: SYNC 3 -- "Helped N times" ticks up ----
  // Refetch via a real in-app navigation (correction 3: navigate-away-
  // and-back, never location.reload() -- a reload white-flashes and
  // reads as a glitch on a 379px panel). This page fetches on mount
  // only (Phase 0 finding), so re-entering it is what actually shows
  // the count the teacher's EOD rating just added.
  await page.goto(`${BASE_URL}/parent-dashboard`, { waitUntil: "domcontentloaded" });
  await humanPause(400);
  await page.goto(`${BASE_URL}/passport/dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByText(/Helped \d+ time/i).first().scrollIntoViewIfNeeded().catch(() => {});
  await beat(81);

  // ---- 82-90: Dashboard, calm resting state ----
  await page.goto(`${BASE_URL}/parent-dashboard`, { waitUntil: "domcontentloaded" });
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
  await runAsChildProcess(ROLE_KEY, warmRoutes, runParentTrack);
}
