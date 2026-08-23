// PWA cold-start fix: generates the apple-touch-startup-image set --
// iOS's own splash screen mechanism. Without these, iOS shows a bare
// black (or white) frame while the webview spins up; with them, it
// shows the app's own branded splash (Prussian Blue + the white logo)
// from the very first frame, matching manifest.ts's background_color
// and src/app/loading.tsx exactly, so there's no colour jump anywhere
// in the launch sequence.
//
// Same generation approach as scripts/generate-brand-icons.mjs
// (sharp, rendered once from the vector SVG master, never
// hand-scaled) -- one raster per device-pixel size, each a solid
// Prussian Blue canvas with the white logo centred at a modest inset.
//
// Portrait iPhone sizes only -- this app's viewport is locked
// (userScalable: false) and phone-only throughout, no iPad layout
// exists, so iPad startup images would be dead weight.
//
// Run with: node scripts/generate-startup-images.mjs

import sharp from "sharp";
import { mkdirSync } from "node:fs";

const LOGO_SVG = "public/brand/behaviour-passport-mark-white.svg";
const OUT_DIR = "public/icons/startup";
const BACKGROUND = { r: 0, g: 79, b: 113 }; // #004F71, Prussian Blue
const LOGO_SCALE = 0.28; // logo width as a fraction of the shorter canvas dimension

mkdirSync(OUT_DIR, { recursive: true });

// [cssWidth, cssHeight, pixelRatio, label] -- label is just for the
// filename/log, not read by iOS. Covers iPhone 8/SE through 16 Pro
// Max; each CSS size is shared by several real device generations
// (e.g. 390x844@3x covers 12/12 Pro/13/13 Pro/14 alike), so this
// short list covers a wide device spread.
const SIZES = [
  [375, 667, 2, "iphone-se2-8"],
  [414, 896, 2, "iphone-xr-11"],
  [375, 812, 3, "iphone-x-11pro-12mini-13mini"],
  [414, 896, 3, "iphone-xsmax-11promax"],
  [390, 844, 3, "iphone-12-13-14"],
  [428, 926, 3, "iphone-12-13promax-14plus"],
  [393, 852, 3, "iphone-14pro-15-16"],
  [430, 932, 3, "iphone-14promax-15plus-15promax-16plus"],
  [402, 874, 3, "iphone-16pro"],
  [440, 956, 3, "iphone-16promax"],
];

async function renderSplash(pixelWidth, pixelHeight) {
  const shorterSide = Math.min(pixelWidth, pixelHeight);
  const logoSize = Math.round(shorterSide * LOGO_SCALE);
  const logo = await sharp(LOGO_SVG).resize(logoSize, logoSize).png().toBuffer();
  const left = Math.round((pixelWidth - logoSize) / 2);
  const top = Math.round((pixelHeight - logoSize) / 2);

  return sharp({
    create: {
      width: pixelWidth,
      height: pixelHeight,
      channels: 3,
      background: BACKGROUND,
    },
  })
    .composite([{ input: logo, left, top }])
    .flatten({ background: BACKGROUND })
    .removeAlpha()
    .png()
    .toBuffer();
}

async function main() {
  const manifestEntries = [];

  for (const [cssWidth, cssHeight, ratio, label] of SIZES) {
    const pixelWidth = cssWidth * ratio;
    const pixelHeight = cssHeight * ratio;
    const filename = `startup-${pixelWidth}x${pixelHeight}.png`;
    const outPath = `${OUT_DIR}/${filename}`;

    const buffer = await renderSplash(pixelWidth, pixelHeight);
    await sharp(buffer).toFile(outPath);
    console.log(`wrote ${outPath} (${label}, ${pixelWidth}x${pixelHeight})`);

    manifestEntries.push({
      url: `/icons/startup/${filename}`,
      media: `(device-width: ${cssWidth}px) and (device-height: ${cssHeight}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
    });
  }

  console.log("\n== Done -- paste this into layout.tsx's appleWebApp.startupImage ==\n");
  console.log(JSON.stringify(manifestEntries, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
