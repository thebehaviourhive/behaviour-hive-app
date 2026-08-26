// Body-map figure assets. The actual SVG files Daniel supplied --
// public/body-map/body-{front,back}-{screen,print}.svg, copied
// byte-for-byte via `cp`, confirmed identical with `diff` against the
// source at copy time -- are fetched and injected raw by BodyFigureSvg.
// Nothing about the figure geometry is hand-transcribed or redrawn here.
// The previous build of this file DID hand-transcribe path data from an
// earlier reference; this replaces that entirely, per the explicit
// instruction not to draw or retype the figures a second time.
//
// viewBox is 220x480, unchanged -- marker coordinates stay normalised
// 0-1 against this box so the same (x, y) pair renders identically in
// the form, the parent view, and the print export.

export const VIEWBOX_WIDTH = 220;
export const VIEWBOX_HEIGHT = 480;

export function svgAssetPath(view: "front" | "back", variant: "screen" | "print"): string {
  return `/body-map/body-${view}-${variant}.svg`;
}
