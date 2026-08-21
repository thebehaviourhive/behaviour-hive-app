// One-off icon generator for the Behaviour Passport logo refresh.
// Never run automatically (not wired into build/dev) -- run by hand
// whenever the master SVG changes: node scripts/generate-brand-icons.mjs
//
// Recipe, per the brief: solid white background (no transparency
// anywhere -- iOS renders a transparent PNG's transparency as black),
// the mark centred at ~80% scale so it breathes within iOS's own
// rounded-corner mask and stays inside Android's maskable safe zone.
//
// "Never hand-scale upward": the 512x512 render is generated directly
// from the vector SVG master (lossless at any size) and treated as
// THE master raster from that point on -- every smaller size is a
// pure downscale of those exact 512 pixels, never re-rendered
// independently, so there's no risk of the smaller sizes drifting from
// what the 512 actually looks like.

import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SVG_PATH = "public/brand/behaviour-passport-mark-blue.svg";
const OUT_DIR = "public/icons";
const MASTER_SIZE = 512;
const INSET_SCALE = 0.8;

mkdirSync(OUT_DIR, { recursive: true });

async function renderOnWhite(canvasSize, markBuffer, markSize) {
  const offset = Math.round((canvasSize - markSize) / 2);
  return sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: markBuffer, left: offset, top: offset }])
    // A solid-channel `create` canvas still comes out RGBA once you
    // composite an RGBA (the SVG mark's own alpha) source onto it --
    // flatten forces any remaining alpha down onto white and drops the
    // channel entirely, which is the actual "no transparency anywhere"
    // guarantee, not just an opaque-looking result that still carries
    // an alpha channel some other renderer could still key off.
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    // flatten() alone still leaves an (now-fully-opaque) alpha channel
    // in the pipeline; removeAlpha() is what actually drops it from
    // the encoded PNG -- confirmed via metadata (hasAlpha/channels),
    // not assumed.
    .removeAlpha()
    .png()
    .toBuffer();
}

async function main() {
  console.log("== Rendering the 512x512 master (direct from SVG, 80% inset on white) ==");
  const markSizeAt512 = Math.round(MASTER_SIZE * INSET_SCALE);
  // Sharp rasterises SVG input at whatever size .resize() asks for
  // (via librsvg), so this alone is already a from-vector render at
  // the target resolution -- no separate density calculation needed.
  const markAt512 = await sharp(SVG_PATH).resize(markSizeAt512, markSizeAt512).png().toBuffer();
  const master512 = await renderOnWhite(MASTER_SIZE, markAt512, markSizeAt512);
  await sharp(master512).toFile(`${OUT_DIR}/passport-icon-512.png`);
  console.log(`  wrote ${OUT_DIR}/passport-icon-512.png`);

  // Maskable variant -- same 80%-inset-on-solid-white recipe already
  // satisfies the W3C maskable safe-zone guidance (important content
  // within the centred 80% of the canvas), so this is the same
  // composition, saved as its own file since the manifest needs a
  // distinct `purpose: "maskable"` entry to point at.
  await sharp(master512).toFile(`${OUT_DIR}/passport-icon-512-maskable.png`);
  console.log(`  wrote ${OUT_DIR}/passport-icon-512-maskable.png`);

  console.log("== Downscaling the master for every smaller size (never upscaling) ==");
  for (const size of [192, 180]) {
    const out = await sharp(master512).resize(size, size).png().toBuffer();
    const filename = size === 180 ? "passport-icon-180.png" : `passport-icon-${size}.png`;
    await sharp(out).toFile(`${OUT_DIR}/${filename}`);
    console.log(`  wrote ${OUT_DIR}/${filename}`);
  }

  console.log("== Favicon (32x32 PNG + .ico) ==");
  const favicon32 = await sharp(master512).resize(32, 32).png().toBuffer();
  await sharp(favicon32).toFile(`${OUT_DIR}/passport-favicon-32.png`);
  console.log(`  wrote ${OUT_DIR}/passport-favicon-32.png`);
  // .ico container: reuse the same 32x32 PNG bytes -- modern browsers
  // (and this app's own next/favicon.ico convention) accept a PNG-
  // payload .ico fine; sharp has no native multi-res .ico writer, and a
  // single 32x32 frame covers every place this app actually surfaces a
  // favicon (browser tabs -- there's no legacy 16x16 Windows shortcut
  // use case here).
  await sharp(favicon32).toFile("src/app/favicon.ico");
  console.log("  wrote src/app/favicon.ico (32x32 PNG payload)");

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
