// Orchestrator for the three-track backup demo video.
//
// Correction 2 (must run CONCURRENTLY, one shared t0): each track runs
// as its OWN Node CHILD PROCESS (see lib.mjs's runAsChildProcess header
// comment for why a single-process design was tried and rejected --
// three Playwright drivers sharing one event loop measurably starved
// Node's timers, so a plain "await beat(21)" with no work of its own
// still fired 80+ seconds late). t0 is one epoch-ms number, computed
// once here and handed to all three children via the DEMO_VIDEO_T0 env
// var -- every process reads the same OS wall clock, so that one
// number is all that's needed for beat(n) to mean the same instant in
// every track; no other IPC/clock-sync required.
//
// Correction 3 (reset the world before every take): runs seed.mjs then
// video/prepare.mjs as the very first step, every run.
//
// Correction 4 (pre-warm before t0): each child process pre-warms its
// own routes (throwaway context, no recordVideo) as soon as it starts,
// before it ever calls beat() -- see runAsChildProcess in lib.mjs. t0
// is set far enough in the future (STARTUP_BUFFER_MS) that pre-warm
// plus browser launch should comfortably finish before it arrives; any
// child that doesn't finish in time just reports an honest overrun on
// its first beat instead of silently starting cold.
//
// Run with: node --env-file=.env.local scripts/demo/video/record-all.mjs

import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  VIDEO_ROOT,
  RAW_DIR,
  BASE_URL,
  DEMO_PASSWORD,
  runNode,
  loginAndSaveStorageState,
  readReport,
  ffprobeDurationSeconds,
} from "./lib.mjs";

const STARTUP_BUFFER_MS = 45000;
const TRACKS = ["parent", "teacher", "clinician"];

function spawnTrack(roleKey, t0, alfiePassportId) {
  return new Promise((resolve) => {
    const script = path.join(VIDEO_ROOT, `record-${roleKey}.mjs`);
    const child = spawn("node", ["--env-file=.env.local", script], {
      cwd: path.join(VIDEO_ROOT, "..", "..", ".."),
      stdio: "inherit",
      env: {
        ...process.env,
        DEMO_VIDEO_T0: String(t0),
        DEMO_VIDEO_ALFIE_ID: alfiePassportId,
      },
    });
    child.on("exit", (code) => resolve({ roleKey, code }));
  });
}

async function main() {
  console.log(`== Recording against ${BASE_URL} ==`);

  // ---- Correction 3: reset the world before every take ----
  console.log("\n== Resetting the demo world (seed.mjs -> video/prepare.mjs) ==");
  runNode("seed.mjs");
  runNode("video/prepare.mjs");

  // Clear stale raw output/reports from a previous attempt so a failed
  // track can never be mistaken for this run's result.
  for (const roleKey of TRACKS) {
    const stale = readdirSync(RAW_DIR).filter((f) => f.startsWith(roleKey));
    for (const f of stale) {
      try {
        (await import("node:fs")).unlinkSync(path.join(RAW_DIR, f));
      } catch {
        // ignore
      }
    }
  }

  const creds = JSON.parse(readFileSync(new URL("../.demo-credentials.json", import.meta.url)));
  const alfiePassportId = creds.parentHero.passportId;

  // ---- Auth: fresh storageState for all three roles, every run ----
  console.log("\n== Capturing fresh storage state for all three roles ==");
  const authBrowser = await chromium.launch();
  await loginAndSaveStorageState(authBrowser, {
    email: creds.parentHero.email,
    password: DEMO_PASSWORD,
    roleKey: "parent",
  });
  await loginAndSaveStorageState(authBrowser, {
    email: creds.teacher.email,
    password: DEMO_PASSWORD,
    roleKey: "teacher",
  });
  await loginAndSaveStorageState(authBrowser, {
    email: creds.clinician.email,
    password: DEMO_PASSWORD,
    roleKey: "clinician",
  });
  await authBrowser.close();
  console.log("  storage state saved for parent, teacher, clinician");

  // ---- The shared clock ----
  const t0 = Date.now() + STARTUP_BUFFER_MS;
  console.log(
    `\n== t0 = ${t0} (${new Date(t0).toISOString()}, ${STARTUP_BUFFER_MS / 1000}s from now) ==`
  );
  console.log("== Spawning three child processes (parent / teacher / clinician) ==\n");

  const exits = await Promise.all(TRACKS.map((roleKey) => spawnTrack(roleKey, t0, alfiePassportId)));

  console.log("\n== Process exit codes ==");
  for (const { roleKey, code } of exits) {
    console.log(`  ${roleKey}: ${code}`);
  }

  // ---- Report ----
  console.log("\n== Overrun summary ==");
  let anyOverrun = false;
  let anyError = false;
  for (const roleKey of TRACKS) {
    const report = readReport(roleKey);
    if (!report) {
      console.log(`  [${roleKey}] no report written -- process likely crashed before finishing`);
      anyError = true;
      continue;
    }
    if (report.error) {
      console.log(`  [${roleKey}] ERROR: ${report.error}`);
      anyError = true;
    }
    if (report.overruns.length === 0) {
      console.log(`  [${roleKey}] no overruns -- every beat landed on time`);
    } else {
      anyOverrun = true;
      for (const o of report.overruns) {
        console.log(`  [${roleKey}] beat ${o.beat}s overran by ${o.overrunMs}ms`);
      }
    }
  }

  console.log("\n== Recorded file durations (target: 90s) ==");
  for (const roleKey of TRACKS) {
    const file = path.join(RAW_DIR, `${roleKey}.webm`);
    const duration = ffprobeDurationSeconds(file);
    console.log(`  ${roleKey}.webm: ${duration?.toFixed(2) ?? "MISSING"}s`);
  }

  if (anyError || exits.some((e) => e.code !== 0)) {
    console.log("\nAt least one track failed -- see errors above before trusting the sync.");
    process.exitCode = 1;
  } else if (anyOverrun) {
    console.log("\nAll tracks completed but at least one beat overran -- check the stills before compositing.");
  } else {
    console.log("\nAll three tracks completed with no overruns.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
