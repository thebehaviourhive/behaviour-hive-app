"use client";

import type { MouseEvent, ReactNode } from "react";
import {
  ARM_IMAGE_LEFT_D,
  ARM_IMAGE_RIGHT_D,
  CREASE_LINES,
  HEAD,
  LR_LABEL_LEFT_X,
  LR_LABEL_RIGHT_X,
  LR_LABEL_Y,
  SPINE_LINE,
  TORSO_LEGS_D,
  VIEWBOX_HEIGHT,
  VIEWBOX_WIDTH,
} from "./bodyFigureData";
import type { BodyView } from "./bodyMapRegions";

interface Palette {
  bodyFill: string;
  bodyStroke: string;
  creaseStroke: string;
  creaseOpacity: number;
  labelFill: string;
}

const SCREEN_PALETTE: Palette = {
  bodyFill: "#F4F9FC",
  bodyStroke: "#004F71",
  creaseStroke: "#BAD9EB",
  creaseOpacity: 1,
  labelFill: "#8CA5B2",
};

const PRINT_PALETTE: Palette = {
  bodyFill: "#FFFFFF",
  bodyStroke: "#000000",
  creaseStroke: "#000000",
  creaseOpacity: 0.4,
  labelFill: "#000000",
};

interface BodyFigureSvgProps {
  view: BodyView;
  variant?: "screen" | "print";
  onPlaceMark?: (xNorm: number, yNorm: number) => void;
  children?: ReactNode;
}

// Renders the body outline from bodyFigureData verbatim -- not redrawn.
// Front and back share identical body paths; the two views differ only
// in the L/R label placement (swapped -- see bodyMapRegions' own
// left/right comment) and the back view's spine guide line.
export function BodyFigureSvg({ view, variant = "screen", onPlaceMark, children }: BodyFigureSvgProps) {
  const palette = variant === "print" ? PRINT_PALETTE : SCREEN_PALETTE;

  // Front: viewed facing you -- the child's right lands on the image's
  // left. Back: viewed from behind -- the child's right lands on the
  // image's right. Neither figure is mirrored; the label just states
  // which side of the image is which, per view.
  const leftLabelText = view === "front" ? "R" : "L";
  const rightLabelText = view === "front" ? "L" : "R";

  function handleClick(event: MouseEvent<SVGSVGElement>) {
    if (!onPlaceMark) return;
    // A marker's own hit target calls stopPropagation() before this
    // handler runs, so reaching here means the tap landed on the figure
    // itself, not an existing marker -- place a new one.
    const rect = event.currentTarget.getBoundingClientRect();
    const xNorm = (event.clientX - rect.left) / rect.width;
    const yNorm = (event.clientY - rect.top) / rect.height;
    onPlaceMark(Math.min(1, Math.max(0, xNorm)), Math.min(1, Math.max(0, yNorm)));
  }

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      width={VIEWBOX_WIDTH}
      height={VIEWBOX_HEIGHT}
      role="img"
      aria-label={`Body map, ${view} view`}
      onClick={onPlaceMark ? handleClick : undefined}
      style={{ display: "block", width: "100%", height: "auto", cursor: onPlaceMark ? "crosshair" : undefined }}
    >
      <ellipse cx={HEAD.cx} cy={HEAD.cy} rx={HEAD.rx} ry={HEAD.ry} fill={palette.bodyFill} stroke={palette.bodyStroke} strokeWidth={2.6} />
      <path d={ARM_IMAGE_RIGHT_D} fill={palette.bodyFill} stroke={palette.bodyStroke} strokeWidth={2.6} />
      <path d={ARM_IMAGE_LEFT_D} fill={palette.bodyFill} stroke={palette.bodyStroke} strokeWidth={2.6} />
      <path d={TORSO_LEGS_D} fill={palette.bodyFill} stroke={palette.bodyStroke} strokeWidth={2.6} strokeLinejoin="round" />

      {CREASE_LINES.map((line, i) => (
        <line
          key={i}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={palette.creaseStroke}
          strokeWidth={1.4}
          opacity={palette.creaseOpacity}
          strokeLinecap="round"
        />
      ))}

      {view === "back" && (
        <line
          x1={SPINE_LINE.x1}
          y1={SPINE_LINE.y1}
          x2={SPINE_LINE.x2}
          y2={SPINE_LINE.y2}
          stroke={palette.creaseStroke}
          strokeWidth={1.5}
          opacity={palette.creaseOpacity}
          strokeDasharray="3 4"
        />
      )}

      <text x={LR_LABEL_LEFT_X} y={LR_LABEL_Y} fontFamily="Quicksand,sans-serif" fontSize={15} fontWeight={700} fill={palette.labelFill} textAnchor="middle">
        {leftLabelText}
      </text>
      <text x={LR_LABEL_RIGHT_X} y={LR_LABEL_Y} fontFamily="Quicksand,sans-serif" fontSize={15} fontWeight={700} fill={palette.labelFill} textAnchor="middle">
        {rightLabelText}
      </text>

      {children}
    </svg>
  );
}
