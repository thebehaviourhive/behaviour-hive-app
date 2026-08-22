// Shared helpers for the three-track backup demo video. Deliberately
// separate from ../lib.mjs (the screenshot-capture pipeline's own
// helpers): that file's launchPage()/freezeClock() are built around a
// single page grabbing static screenshots, not three concurrent,
// video-recording, wall-clock-synced contexts. Reuses its viewport/
// locale/timezone CONVENTIONS, not its code.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

// ffmpeg-static's package.json has no "exports"/ESM entry -- it's a
// plain CJS module, so this .mjs file needs its own require() to load
// it, per Node's standard ESM/CJS interop pattern.
const require = createRequire(import.meta.url);

export const VIDEO_ROOT = fileURLToPath(new URL(".", import.meta.url));
export const AUTH_DIR = path.join(VIDEO_ROOT, ".auth");
export const RAW_DIR = path.join(VIDEO_ROOT, "raw");
export const OUT_DIR = path.join(VIDEO_ROOT, "out");
mkdirSync(AUTH_DIR, { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// Corrected per review: record against the deployed app, not a local
// dev server -- a 90s unattended take has no room for a Fast Refresh
// or compile hitch landing mid-beat, and the deployed build is what
// the principal would actually see if the live demo were used instead.
export const BASE_URL = process.env.DEMO_VIDEO_BASE_URL || "https://behaviour-hive-app.vercel.app";

export const VIDEO_SIZE = { width: 390, height: 844 };

export const DEMO_PASSWORD = "DemoTrial-2026!";

// ---------------------------------------------------------------------
// The shared clock. record-all.mjs computes ONE t0 (an epoch-ms
// number) and hands it to all three tracks via the DEMO_VIDEO_T0 env
// var. Each track runs as its OWN Node child process, not concurrent
// async functions sharing one process -- an earlier single-process
// design was tried and rejected: three Playwright drivers doing real
// CDP/video-frame work in one event loop measurably starved Node's
// timer phase, so a plain "await beat(21)" with NO work of its own
// still fired 80+ seconds late because two OTHER tracks' work was
// blocking the shared loop. Three processes means three independent
// event loops -- nothing in one track's process can delay another's
// timers. All three still land on the exact same wall-clock instant
// because they all read the same OS clock and were handed the same
// epoch number; no IPC/clock-sync beyond that one env var is needed.
// ---------------------------------------------------------------------
export function makeBeat(t0, trackName, overruns) {
  return async function beat(sec) {
    const wait = t0 + sec * 1000 - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    } else {
      const overrun = -wait;
      console.warn(`[${trackName}] beat ${sec}s overran by ${overrun}ms`);
      overruns.push({ track: trackName, beat: sec, overrunMs: overrun });
    }
  };
}

// ---------------------------------------------------------------------
// Frozen in-page clock -- the app has real time-of-day gates that
// would otherwise silently break the recording depending on when it's
// actually run:
// - src/app/teacher/passport/[passportId]/page.tsx: "Complete EOD
//   Update" only renders at all when `new Date().getHours() >= 13` --
//   run this before 1pm real time and the button (and the whole
//   58-72s EOD beat) simply doesn't exist to tap. This is what a first
//   attempt at this actually hit.
// - src/app/parent-dashboard/page.tsx: an isBefore1pm flag changes the
//   "waiting for today's update" card's copy.
// Also satisfies the beat sheet's own "same system clock... across all
// three" requirement.
//
// Deliberately NOT ../lib.mjs's own freezeClock technique (replacing
// the whole Date class / Date.now()) -- tried that first here and it
// silently broke Supabase auth: the SDK validates the saved session's
// JWT against Date.now(), and a globally frozen "now" that doesn't
// match when the token was actually issued reads as expired, so every
// recording context quietly bounced to /login instead of showing any
// app content (confirmed by isolating it in a throwaway script -- the
// page rendered the login form, not an error). Both gates only ever
// call .getHours() on a fresh `new Date()`, never Date.now() or epoch
// arithmetic -- patching just that one method leaves every timestamp/
// epoch computation (auth included) completely real, while still
// making both gates read as afternoon.
// ---------------------------------------------------------------------
const FROZEN_HOUR = 15;

export async function freezeClock(page) {
  await page.addInitScript((hour) => {
    // Only .getHours() is patched -- confirmed by grep that it's the
    // only method either gate calls. Every other Date method
    // (getMinutes, getTime, valueOf, etc.) stays completely real, so
    // relative-time formatting ("5 mins ago") and epoch/auth math
    // elsewhere are both unaffected.
    Date.prototype.getHours = function () {
      return hour;
    };
  }, FROZEN_HOUR);
}

// ---------------------------------------------------------------------
// Synthetic cursor -- Playwright's own recording shows no pointer, and
// in a silent video the viewer otherwise can't tell what caused a
// change. A small Prussian Blue dot, injected before any app script
// runs so it survives every client-side navigation in this context.
// ---------------------------------------------------------------------
export async function injectCursor(page) {
  await page.addInitScript(() => {
    const SIZE = 14;
    function mount() {
      if (document.getElementById("__demo_cursor__")) return;
      const dot = document.createElement("div");
      dot.id = "__demo_cursor__";
      Object.assign(dot.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: SIZE + "px",
        height: SIZE + "px",
        borderRadius: "50%",
        background: "#004F71",
        opacity: "0.7",
        pointerEvents: "none",
        zIndex: "2147483647",
        transform: "translate(-9999px, -9999px)",
        transition: "transform 250ms ease, opacity 250ms ease, box-shadow 250ms ease",
        boxShadow: "0 0 0 0 rgba(0, 79, 113, 0.5)",
      });
      document.documentElement.appendChild(dot);
      window.__demoCursorMove = (x, y) => {
        dot.style.transform = `translate(${x - SIZE / 2}px, ${y - SIZE / 2}px)`;
      };
      window.__demoCursorPulse = () => {
        dot.style.boxShadow = "0 0 0 10px rgba(0, 79, 113, 0)";
        dot.style.opacity = "1";
        setTimeout(() => {
          dot.style.boxShadow = "0 0 0 0 rgba(0, 79, 113, 0)";
          dot.style.opacity = "0.7";
        }, 250);
      };
    }
    if (document.documentElement) mount();
    document.addEventListener("DOMContentLoaded", mount);
  });
}

async function cursorMoveTo(page, x, y) {
  await page.evaluate(
    ([x, y]) => window.__demoCursorMove && window.__demoCursorMove(x, y),
    [x, y]
  );
}

async function cursorPulse(page) {
  await page.evaluate(() => window.__demoCursorPulse && window.__demoCursorPulse());
}

// Moves the synthetic cursor to a locator's centre, waits briefly (the
// viewer needs a moment to register the cursor arriving before the
// tap), pulses, then performs the real Playwright click. Use this for
// every on-camera tap; use locator.click() directly only for warm-up
// (pre-t0, never recorded) navigation.
export async function tapWithCursor(page, locator, opts = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("tapWithCursor: locator has no bounding box (not visible)");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await cursorMoveTo(page, x, y);
  await page.waitForTimeout(280);
  await cursorPulse(page);
  await locator.click(opts);
}

export async function humanPause(ms = 700) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// Auth: plain email/password sign-in (no OTP/magic-link exists in this
// app -- confirmed in Phase 0), storageState saved once and reused by
// every recording context so the timed take never shows the login
// screen.
// ---------------------------------------------------------------------
export function storageStatePath(roleKey) {
  return path.join(AUTH_DIR, `${roleKey}.json`);
}

export async function loginAndSaveStorageState(browser, { email, password, roleKey }) {
  const context = await browser.newContext({ viewport: VIDEO_SIZE });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("sarah.murphy@email.com").fill(email);
  await page.getByPlaceholder("••••••••••").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });

  // Fresh accounts land on the consent gate every time -- accept it so
  // the saved storageState is genuinely past onboarding.
  const acceptButton = page.getByRole("button", { name: "Accept and continue" });
  if (await acceptButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    const checkbox = page.locator('input[type="checkbox"]').first();
    await checkbox.check({ force: true });
    await acceptButton.click();
    await page.waitForTimeout(1500);
  }

  await context.storageState({ path: storageStatePath(roleKey) });
  await context.close();
}

// ---------------------------------------------------------------------
// Pre-warm -- correction 4: hit every route a track will visit, in a
// THROWAWAY (non-recording) context, before t0. A cold Vercel function
// on the first navigation could blow an entire beat, and this doesn't
// touch the real recording context's own frame 0 (which must be the
// beat sheet's t=0 content, not warm-up traffic), since Phase 3's
// ffmpeg step resets each webm's PTS to its own first frame.
// ---------------------------------------------------------------------
export async function preWarm(browser, roleKey, routes) {
  const context = await browser.newContext({
    viewport: VIDEO_SIZE,
    storageState: storageStatePath(roleKey),
  });
  const page = await context.newPage();
  await freezeClock(page);
  for (const route of routes) {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" }).catch((err) => {
      console.warn(`[prewarm:${roleKey}] ${route} failed: ${err.message}`);
    });
  }
  await context.close();
}

export async function newRecordingContext(browser, roleKey, outDir) {
  const context = await browser.newContext({
    viewport: VIDEO_SIZE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "en-IE",
    timezoneId: "Europe/Dublin",
    storageState: storageStatePath(roleKey),
    recordVideo: { dir: outDir, size: VIDEO_SIZE },
  });
  const page = await context.newPage();
  await freezeClock(page);
  await injectCursor(page);
  return { context, page };
}

export function ffmpegBin() {
  // Resolved from THIS nested package's own node_modules, never the
  // root -- see package.json's own comment.
  return require(path.join(VIDEO_ROOT, "node_modules", "ffmpeg-static", "index.js"));
}

export function ffprobeDurationSeconds(filePath) {
  const ffmpeg = ffmpegBin();
  // ffmpeg-static ships ffmpeg only, not ffprobe -- but ffmpeg itself
  // reports duration on stderr for any input, which is all the
  // gate/report needs (a real ffprobe binary is used in Phase 3/4 for
  // the fuller stream inspection instead).
  try {
    execFileSync(ffmpeg, ["-i", filePath], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    const stderr = err.stderr?.toString() ?? "";
    const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (match) {
      const [, h, m, s] = match;
      return Number(h) * 3600 + Number(m) * 60 + Number(s);
    }
  }
  return null;
}

export function reportPath(roleKey) {
  return path.join(RAW_DIR, `${roleKey}-report.json`);
}

export function writeReport(roleKey, report) {
  writeFileSync(reportPath(roleKey), JSON.stringify(report, null, 2));
}

export function readReport(roleKey) {
  const p = reportPath(roleKey);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

// Runs one track as its OWN Node process/event loop -- see
// record-all.mjs's header comment for why. t0 arrives via
// DEMO_VIDEO_T0 (an epoch-millisecond string): every process reads the
// same OS wall clock, so an epoch number is unambiguous across
// processes on the same machine, no IPC/clock-sync needed beyond
// passing that one number through the environment.
export async function runAsChildProcess(roleKey, warmRoutesFn, trackFn) {
  const { chromium } = await import("playwright");
  const t0 = process.env.DEMO_VIDEO_T0 ? Number(process.env.DEMO_VIDEO_T0) : Date.now() + 3000;
  const alfiePassportId = process.env.DEMO_VIDEO_ALFIE_ID || null;

  const browser = await chromium.launch();
  await preWarm(browser, roleKey, warmRoutesFn(alfiePassportId));

  // recordVideo captures from the moment its context is CREATED, not
  // from t0 -- creating that context right after pre-warm (which can
  // finish well inside the startup buffer) left tens of seconds of
  // idle recording before beat(0)'s own content ever appeared, and
  // every .webm ran ~130s instead of the intended 90. Waiting here
  // until just before t0 means newRecordingContext() (called at the
  // top of each track function) starts capturing right as real content
  // begins, not during the buffer.
  const leadTimeMs = t0 - Date.now() - 2000;
  if (leadTimeMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, leadTimeMs));
  } else {
    console.warn(`[${roleKey}] pre-warm ran past t0 by ${-leadTimeMs}ms -- recording starts late`);
  }

  const overruns = [];
  let videoPath = null;
  let error = null;
  try {
    videoPath = await trackFn({ t0, browser, outDir: RAW_DIR, overruns, alfiePassportId });
  } catch (err) {
    error = err.message || String(err);
    // Track functions close their own context and attach the (still
    // valid, if partial) video path to the error before re-throwing --
    // see e.g. record-teacher.mjs's catch/throw at the end of its beat
    // sequence -- so a failed beat still leaves something to inspect.
    videoPath = err.videoPath || null;
    console.error(`[${roleKey}] FAILED:`, err);
  }
  await browser.close();

  let finalVideoPath = null;
  if (videoPath) {
    const { copyFileSync } = await import("node:fs");
    finalVideoPath = path.join(RAW_DIR, `${roleKey}.webm`);
    copyFileSync(videoPath, finalVideoPath);
  }

  writeReport(roleKey, {
    roleKey,
    t0,
    overruns,
    error,
    videoPath: finalVideoPath,
  });

  if (error) process.exitCode = 1;
}

export function runNode(scriptRelPath, extraEnv = {}) {
  const script = path.join(VIDEO_ROOT, "..", scriptRelPath);
  execFileSync("node", ["--env-file=.env.local", script], {
    cwd: path.join(VIDEO_ROOT, "..", "..", ".."),
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
}
