import { VIEWBOX_HEIGHT, VIEWBOX_WIDTH } from "./bodyFigureData";

// Left/right convention, stated once here rather than left implicit:
// nothing is mirrored -- front is drawn as the child facing you (their
// right hand lands on the image's left), back is drawn as the child
// facing away (their right hand lands on the image's right). Both
// figures carry their own "L"/"R" labels for this reason (bodyFigureData
// swaps them per view) -- side() below is the same rule expressed as
// code, so the legend text and the printed labels can never disagree.
export type BodyView = "front" | "back";
export type Side = "left" | "right";

export function sideForMark(view: BodyView, xNorm: number): Side {
  const isImageLeftHalf = xNorm * VIEWBOX_WIDTH < VIEWBOX_WIDTH / 2;
  if (view === "front") return isImageLeftHalf ? "right" : "left";
  return isImageLeftHalf ? "left" : "right";
}

// Region bands grounded in the actual joint landmarks the source SVGs
// draw -- the elbow crease sits at y=176, the knee crease at y=336 (see
// bodyFigureData.CREASE_LINES) -- not guessed independently of the art.
// x bands separate the arms (which sit outside the torso/leg column)
// from everything else; this is a legend-text approximation, not a
// medical hit-test -- good enough to tell "forearm" from "upper arm",
// which is the one thing the flat mitten shape it replaces could not do.
export function regionForMark(view: BodyView, xNorm: number, yNorm: number): string {
  const x = xNorm * VIEWBOX_WIDTH;
  const y = yNorm * VIEWBOX_HEIGHT;
  const side = sideForMark(view, xNorm);
  const isArmColumn = x < 90 || x > 130;

  if (y < 78) return "head";

  if (isArmColumn && y >= 78 && y <= 260) {
    return y < 176 ? `${side} upper arm` : `${side} forearm`;
  }
  if (isArmColumn && y > 260 && y <= 300) {
    return `${side} hand`;
  }

  if (!isArmColumn && y >= 74 && y < 240) {
    return y < 152 ? "chest" : "abdomen";
  }

  if (!isArmColumn && y >= 240 && y <= 438) {
    return y < 336 ? `${side} thigh` : `${side} lower leg`;
  }
  if (!isArmColumn && y > 438) {
    return `${side} foot`;
  }

  return "torso";
}
