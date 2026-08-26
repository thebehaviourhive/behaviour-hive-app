// Region and side are no longer derived from tapped coordinates -- they
// come straight off the tapped SVG path's own data-region/data-side
// attributes (BodyFigureSvg's event delegation reads them directly).
// This file's job shrinks to display labels only: how a stored region
// slug (which must match incident_body_regions.value and regions.json
// exactly -- that's the whole point of this rebuild) reads as English.

export type BodyView = "front" | "back";
export type Side = "left" | "right" | "centre";

// Matches this module's own established clinical wording from the
// earlier coordinate-based build (lower_arm -> forearm, upper_leg ->
// thigh) -- not a fresh guess, continuing what was already decided.
// Display-only: the stored value is always the raw slug.
const REGION_DISPLAY_LABEL: Record<string, string> = {
  head: "head",
  chest: "chest",
  stomach: "stomach",
  upper_arm: "upper arm",
  lower_arm: "forearm",
  hand: "hand",
  upper_back: "upper back",
  lower_back: "lower back",
  upper_leg: "thigh",
  lower_leg: "lower leg",
};

export function regionLabel(regionValue: string): string {
  return REGION_DISPLAY_LABEL[regionValue] ?? regionValue;
}

// "left lower_arm" -> "left forearm"; centre regions (head, chest,
// stomach, upper_back, lower_back) never take a side prefix.
export function regionWithSideLabel(regionValue: string, side: Side): string {
  const label = regionLabel(regionValue);
  return side === "centre" ? label : `${side} ${label}`;
}
