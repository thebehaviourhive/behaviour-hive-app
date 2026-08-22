// Phase 3: composites plate.png + the three recorded tracks into the
// final demo-three-track.mp4. A Node wrapper around ffmpeg (not a
// plain .sh) so the overlay geometry is read from plate-coords.json --
// generate-plate.mjs's own output -- rather than hand-duplicated
// between the plate image and this command, which is exactly the
// "reads its overlay coordinates as JSON" requirement.
//
// Run with: node scripts/demo/video/composite.mjs
// (after: node scripts/demo/video/generate-plate.mjs, and after
// record-all.mjs has produced raw/{parent,teacher,clinician}.webm)

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VIDEO_ROOT, RAW_DIR, OUT_DIR, ffmpegBin } from "./lib.mjs";

const PLATE_PNG = path.join(VIDEO_ROOT, "plate.png");
const COORDS_JSON = path.join(VIDEO_ROOT, "plate-coords.json");
const OUT_MP4 = path.join(OUT_DIR, "demo-three-track.mp4");
const OUT_SRT = path.join(OUT_DIR, "demo-three-track.srt");

// One cue per beat from the corrected beat sheet, written from the
// viewer's side in plain language -- no product jargon. The three
// SYNC cues name the connection explicitly, since that's the whole
// claim this video exists to make. NOT burned in (kept as a separate
// file, per the brief) so it can be turned on or off on the day.
const SRT_CUES = [
  { start: 0, end: 9.5, text: "Six children on one teacher's morning list." },
  { start: 10, end: 21.5, text: "Alfie's mum checks in from home before school." },
  {
    start: 22,
    end: 31.5,
    text: "Alfie's mum checked in at home — his teacher sees it before the class starts.",
  },
  { start: 32, end: 47.5, text: "In class, his teacher notes what just happened — a few taps, done." },
  { start: 48, end: 57.5, text: "What the teacher just logged is already on Alfie's clinical record." },
  { start: 58, end: 71.5, text: "End of day: a quick update home, and a strategy rated on the spot." },
  {
    start: 72,
    end: 81.5,
    text: "That rating lands straight in the strategy's own results — no one had to send it.",
  },
  { start: 82, end: 90, text: "One child. Three people. Nobody had to chase anybody." },
];

function srtTimestamp(totalSeconds) {
  const wholeSeconds = Math.floor(totalSeconds);
  const ms = Math.round((totalSeconds - wholeSeconds) * 1000);
  const h = Math.floor(wholeSeconds / 3600);
  const m = Math.floor((wholeSeconds % 3600) / 60);
  const s = wholeSeconds % 60;
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function writeSrt() {
  const body = SRT_CUES.map(
    (cue, i) => `${i + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text}\n`
  ).join("\n");
  writeFileSync(OUT_SRT, body);
  console.log(`wrote ${OUT_SRT}`);
}

function requireFile(p, hint) {
  if (!existsSync(p)) {
    throw new Error(`Missing ${p}${hint ? ` -- ${hint}` : ""}`);
  }
}

async function main() {
  requireFile(PLATE_PNG, "run generate-plate.mjs first");
  requireFile(COORDS_JSON, "run generate-plate.mjs first");
  const parentWebm = path.join(RAW_DIR, "parent.webm");
  const teacherWebm = path.join(RAW_DIR, "teacher.webm");
  const clinicianWebm = path.join(RAW_DIR, "clinician.webm");
  requireFile(parentWebm, "run record-all.mjs first");
  requireFile(teacherWebm, "run record-all.mjs first");
  requireFile(clinicianWebm, "run record-all.mjs first");

  const coords = JSON.parse(readFileSync(COORDS_JSON, "utf8"));
  const { parent, teacher, clinician } = coords.phones;
  const { width: canvasW, height: canvasH } = coords.canvas;

  // tpad guards a track finishing marginally early (recordVideo's own
  // stop can land a frame or two short of the others); -t 90 trims the
  // composite to a common length regardless of any track's exact
  // duration.
  const filterComplex =
    `[1:v]scale=-2:${parent.h},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=5[p];` +
    `[2:v]scale=-2:${teacher.h},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=5[t];` +
    `[3:v]scale=-2:${clinician.h},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=5[c];` +
    `[0:v]scale=${canvasW}:${canvasH}[bg];` +
    `[bg][p]overlay=${parent.x}:${parent.y}[b1];` +
    `[b1][t]overlay=${teacher.x}:${teacher.y}[b2];` +
    `[b2][c]overlay=${clinician.x}:${clinician.y}[out]`;

  const args = [
    "-y",
    "-loop", "1", "-i", PLATE_PNG,
    "-i", parentWebm,
    "-i", teacherWebm,
    "-i", clinicianWebm,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-an",
    "-t", "90",
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    OUT_MP4,
  ];

  console.log("== Compositing ==");
  console.log(`  plate: ${PLATE_PNG}`);
  console.log(`  parent: ${parentWebm}`);
  console.log(`  teacher: ${teacherWebm}`);
  console.log(`  clinician: ${clinicianWebm}`);
  console.log(`  output: ${OUT_MP4}`);

  const ffmpeg = ffmpegBin();
  execFileSync(ffmpeg, args, { stdio: "inherit" });

  writeSrt();

  console.log("\n== Done ==");
  console.log(OUT_MP4);
  console.log(OUT_SRT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
