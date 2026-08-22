// TEACHER track (Aoife Ryan) -- the hero track: centre panel, largest,
// because her staff are the ones being asked to do the work. One
// Playwright script, runnable standalone or via record-all.mjs (shared
// t0 -- see record-parent.mjs's header for why that matters).
//
// Corrected beat sheet (Phase 2 review):
//   0-10   Class list, all six children visible
//   10-22  Holds on the class list
//   22-32  SYNC 1 -- navigate-away-and-back. Alfie's row picks up a
//          morning chip. The other five rows do not change.
//   32-48  HERO BEAT -- logs an ABC on Alfie: antecedent, behaviour,
//          consequence, save
//   48-58  SYNC 2 -- ABC saved, appears in today's list
//   58-72  End-of-day update: settled/energy/flags/notes, rate a
//          strategy, submit
//   72-82  SYNC 3 -- back to class list, Alfie's row shows the day closed
//   82-90  Class list, six children, day done
//
// Recon findings (all confirmed live against the deployed app, not
// guessed from source):
// - The six pupil cards on /teacher/dashboard are plain <button>s with
//   no navigation of their own (tapping one is a no-op). All six sit
//   in one screen with no scrolling needed at 375-ish px, so "keep
//   Alfie findable" is trivially satisfied there -- no scroll-jump
//   risk. The real per-pupil detail view is reached via
//   /teacher/students' genuine links, which is what SYNC 1 uses.
// - Alfie's Classroom Profile (/teacher/passport/[id]) and the EOD
//   wizard (/teacher/eod/[id]) do NOT render the standard bottom nav
//   (they have their own pinned action bar instead) -- a first attempt
//   using a "Dashboard" nav-link tap from those pages timed out
//   waiting for an element that isn't there. Returning to the
//   dashboard from either page uses a direct navigation instead, which
//   is what a teacher tapping a home/back affordance actually produces
//   on screen either way -- not a location.reload() (correction 3's
//   actual target: avoiding a same-page white-flash), just a normal
//   navigation to a different route.

import { BASE_URL, makeBeat, tapWithCursor, humanPause, newRecordingContext, runAsChildProcess } from "./lib.mjs";

export const ROLE_KEY = "teacher";
export function warmRoutes(alfiePassportId) {
  return [
    "/teacher/dashboard",
    "/teacher/students",
    "/teacher/abc-log",
    `/teacher/passport/${alfiePassportId}`,
    `/teacher/eod/${alfiePassportId}`,
  ];
}

export async function runTeacherTrack({ t0, browser, outDir, overruns }) {
  const { context, page } = await newRecordingContext(browser, ROLE_KEY, outDir);
  const beat = makeBeat(t0, "teacher", overruns);
  let error = null;

  try {
    // ---- 0-10: Class list, all six children visible ----
    await page.goto(`${BASE_URL}/teacher/dashboard`, { waitUntil: "domcontentloaded" });
    await beat(9);

    // ---- 10-22: Holds on the class list ----
    await beat(21);

    // ---- 22-32: SYNC 1 -- navigate-away-and-back ----
    // Real navigation (Students -> Alfie's profile -> Dashboard), not
    // location.reload() -- this is what actually forces the
    // dashboard's data hooks to remount and refetch (Phase 0 finding:
    // they fetch on mount only), and it reads as a real teacher action
    // rather than a glitch.
    await tapWithCursor(page, page.getByRole("link", { name: "Students" }).first());
    await page.waitForURL(/\/teacher\/students/, { timeout: 10000 }).catch(() => {});
    await humanPause(500);
    await tapWithCursor(page, page.getByRole("button", { name: /Alfie/i }).first());
    await page.waitForURL(/\/teacher\/passport\//, { timeout: 10000 }).catch(() => {});
    await humanPause(700);
    // "Today's Context" now shows the parent's check-in -- hold a beat
    // on the direct proof before returning to the class-list grid view.
    await page.getByText(/Today's Context/i).scrollIntoViewIfNeeded().catch(() => {});
    await humanPause(900);
    await page.goto(`${BASE_URL}/teacher/dashboard`, { waitUntil: "domcontentloaded" });
    await beat(31);

    // ---- 32-48: HERO BEAT -- logs an ABC on Alfie ----
    await tapWithCursor(page, page.getByRole("link", { name: "ABC Log" }).first());
    await page.waitForURL(/\/teacher\/abc-log/, { timeout: 10000 }).catch(() => {});
    await humanPause(400);
    await tapWithCursor(page, page.getByRole("button", { name: "Alfie B." }));
    await humanPause(300);
    await tapWithCursor(page, page.getByRole("button", { name: "ABC Log" }));
    await humanPause(500);

    // Step 1 of 4: intensity.
    await tapWithCursor(page, page.getByRole("button", { name: "3", exact: true }));
    await humanPause(350);
    await tapWithCursor(page, page.getByRole("button", { name: "Next" }));
    await humanPause(500);

    // Step 2 of 4: antecedent.
    await tapWithCursor(page, page.getByRole("button", { name: "Task demand placed" }));
    await humanPause(350);
    await tapWithCursor(page, page.getByRole("button", { name: "Next" }));
    await humanPause(500);

    // Step 3 of 4: behaviour.
    await tapWithCursor(page, page.getByRole("button", { name: "Vocal outburst" }));
    await humanPause(350);
    await tapWithCursor(page, page.getByRole("button", { name: "Next" }));
    await humanPause(500);

    // Step 4 of 4: consequence, then save.
    await tapWithCursor(page, page.getByRole("button", { name: "Task removed or delayed" }));
    await humanPause(350);
    await tapWithCursor(page, page.getByRole("button", { name: "Save ABC Log" }));
    await page.waitForURL(/\/teacher\/dashboard/, { timeout: 10000 }).catch(() => {});
    await beat(47);

    // ---- 48-58: SYNC 2 -- ABC saved, appears in today's list ----
    // Confirmed live: the post-save redirect already lands on a
    // freshly-mounted dashboard whose Recent Activity shows the new
    // entry immediately -- no extra reload/nav needed here.
    await page.getByText(/Recent Activity/i).scrollIntoViewIfNeeded().catch(() => {});
    await beat(57);

    // ---- 58-72: End-of-day update ----
    await tapWithCursor(page, page.getByRole("link", { name: "Students" }).first());
    await page.waitForURL(/\/teacher\/students/, { timeout: 10000 }).catch(() => {});
    await humanPause(400);
    await tapWithCursor(page, page.getByRole("button", { name: /Alfie/i }).first());
    await page.waitForURL(/\/teacher\/passport\//, { timeout: 10000 }).catch(() => {});
    // Generous explicit wait, not a blind pause -- under three
    // concurrent browsers hitting the deployed app at once, this
    // page's clinical-content fetch (which the action bar waits on
    // before rendering) can genuinely take longer than it does solo.
    const eodButton = page.getByRole("button", { name: /Complete EOD Update|EOD Update/i });
    await eodButton.waitFor({ state: "visible", timeout: 45000 });
    await tapWithCursor(page, eodButton);
    await page.waitForURL(/\/teacher\/eod\//, { timeout: 10000 }).catch(() => {});
    await humanPause(500);

    // Step 1 of 5: settled state (auto-advances).
    await tapWithCursor(page, page.getByRole("button", { name: /Settled and Regulated/i }));
    await humanPause(500);

    // Step 2 of 5: energy level (auto-advances).
    await tapWithCursor(page, page.getByRole("button", { name: "4", exact: true }));
    await humanPause(500);

    // Step 3 of 5: flags -- "No flags today" bypass, then Continue.
    await tapWithCursor(page, page.getByRole("button", { name: /No flags today/i }));
    await humanPause(300);
    await tapWithCursor(page, page.getByRole("button", { name: "Continue" }));
    await humanPause(500);

    // Step 4 of 5: heads-up note, then Submit Update -- submits the
    // update itself AND auto-advances into the optional strategy-
    // rating step (confirmed live: both actions happen from this one
    // tap).
    await page.getByRole("textbox").first().fill("Great day overall, settled after lunch.");
    await humanPause(300);
    await tapWithCursor(page, page.getByRole("button", { name: /Submit Update/i }));
    await humanPause(900);

    // Step 5 of 5: rate a strategy -- expand the card, then "Helped"
    // (fire-and-forget, per the app's own posture -- no further tap
    // needed once this lands).
    await tapWithCursor(page, page.getByRole("button", { name: /Give a 2-minute transition warning/i }));
    await humanPause(400);
    await tapWithCursor(page, page.getByRole("button", { name: "Helped", exact: true }));
    await humanPause(500);
    await beat(71);

    // ---- 72-82: SYNC 3 -- back to class list, Alfie's row shows the day closed ----
    await page.goto(`${BASE_URL}/teacher/dashboard`, { waitUntil: "domcontentloaded" });
    await beat(81);

    // ---- 82-90: Class list, six children, day done ----
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
  await runAsChildProcess(ROLE_KEY, warmRoutes, runTeacherTrack);
}
