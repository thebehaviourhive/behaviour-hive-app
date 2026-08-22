// Phase 3: the background plate for the three-track composite.
// 1920x1080, white, with a labelled Pastel Blue bezel around where
// each phone recording will be overlaid, and the bottom 130px left
// completely clear as the caption safe area.
//
// Built as one SVG string, rasterised in a single sharp call --
// simpler and more reliable than compositing separate raster layers
// for the rects/shadows/text, and gives exact vector control over the
// rounded-rect bezels and drop shadows.
//
// Emits plate.png AND plate-coords.json (the overlay x/y/w/h ffmpeg
// actually needs), so composite.sh reads geometry from one place
// instead of it being hand-duplicated between this script and the
// ffmpeg command.
//
// Run with: node scripts/demo/video/generate-plate.mjs

import sharp from "sharp";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { VIDEO_ROOT } from "./lib.mjs";

const CANVAS = { width: 1920, height: 1080 };
const PRUSSIAN_BLUE = "#004F71";
const PASTEL_BLUE = "#BAD9EB";
const CAPTION_SAFE_HEIGHT = 130;

// The three phone rects -- starting values from the brief, already
// consistent with the actual recorded footage's own 390x844 aspect
// ratio (390 * 820/844 = 379.1, 390 * 690/844 = 318.9 -- matches the
// brief's own "w ~379"/"w ~319" notes almost exactly).
const PHONES = {
  parent: { x: 226, y: 185, w: 319, h: 690, label: "Parent — at home", labelSize: 22 },
  teacher: { x: 771, y: 120, w: 379, h: 820, label: "Teacher — in class", labelSize: 28 },
  clinician: { x: 1376, y: 185, w: 319, h: 690, label: "Clinician — oversight", labelSize: 22 },
};

const BEZEL_MARGIN = 8;

function bezelFor(phone) {
  return {
    x: phone.x - BEZEL_MARGIN,
    y: phone.y - BEZEL_MARGIN,
    w: phone.w + BEZEL_MARGIN * 2,
    h: phone.h + BEZEL_MARGIN * 2,
  };
}

function buildSvg() {
  const parts = [];
  parts.push(
    `<svg width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" xmlns="http://www.w3.org/2000/svg">`
  );
  parts.push(`<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="#FFFFFF"/>`);
  parts.push(
    `<defs><filter id="bezelShadow" x="-30%" y="-30%" width="160%" height="160%">` +
      `<feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.16"/>` +
      `</filter></defs>`
  );

  for (const [key, phone] of Object.entries(PHONES)) {
    const bezel = bezelFor(phone);
    const centreX = phone.x + phone.w / 2;
    const labelBaselineY = bezel.y - (key === "teacher" ? 26 : 22);
    parts.push(
      `<rect x="${bezel.x}" y="${bezel.y}" width="${bezel.w}" height="${bezel.h}" rx="26" ry="26" ` +
        `fill="none" stroke="${PASTEL_BLUE}" stroke-width="1.5" filter="url(#bezelShadow)"/>`
    );
    parts.push(
      `<text x="${centreX}" y="${labelBaselineY}" text-anchor="middle" ` +
        `font-family="'Baloo 2','Helvetica Neue',Arial,sans-serif" font-weight="700" ` +
        `font-size="${phone.labelSize}" fill="${PRUSSIAN_BLUE}">${phone.label}</text>`
    );
  }

  // Caption safe-area guide is deliberately NOT drawn -- the brief
  // wants that band completely clear, not marked; it's kept clear by
  // construction (checked below, not by drawing a placeholder there).
  parts.push(`</svg>`);
  return parts.join("");
}

async function main() {
  // Sanity check, not just aspiration: fail loudly if any bezel
  // actually reaches into the caption safe area, instead of silently
  // shipping a plate that clips captions later.
  const safeAreaTop = CANVAS.height - CAPTION_SAFE_HEIGHT;
  for (const [key, phone] of Object.entries(PHONES)) {
    const bezel = bezelFor(phone);
    const bottom = bezel.y + bezel.h;
    if (bottom > safeAreaTop) {
      throw new Error(
        `${key}'s bezel bottom (${bottom}px) reaches into the caption safe area (starts at ${safeAreaTop}px)`
      );
    }
  }

  const svg = buildSvg();
  const outPng = path.join(VIDEO_ROOT, "plate.png");
  await sharp(Buffer.from(svg)).png().toFile(outPng);
  console.log(`wrote ${outPng}`);

  const coords = {
    canvas: CANVAS,
    captionSafeAreaTop: safeAreaTop,
    phones: Object.fromEntries(
      Object.entries(PHONES).map(([key, phone]) => [key, { x: phone.x, y: phone.y, w: phone.w, h: phone.h }])
    ),
  };
  const outJson = path.join(VIDEO_ROOT, "plate-coords.json");
  writeFileSync(outJson, JSON.stringify(coords, null, 2));
  console.log(`wrote ${outJson}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
