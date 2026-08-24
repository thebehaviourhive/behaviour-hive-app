"use client";

import type { MouseEvent } from "react";
import { VIEWBOX_HEIGHT, VIEWBOX_WIDTH } from "./bodyFigureData";

interface BodyMapMarkerProps {
  xNorm: number;
  yNorm: number;
  number: number;
  isSelected?: boolean;
  variant?: "screen" | "print";
  onSelect?: () => void;
}

// One marker style, always -- solid Prussian Blue (or solid black for
// print), white number, white ring. An unconfirmed placement never
// reaches this component at all (nothing is drawn until a type is
// picked), so there is no second colour competing with the real ones.
// Selection is shown as an outer ring in the SAME hue, not a colour
// change, for the same reason.
export function BodyMapMarker({ xNorm, yNorm, number, isSelected, variant = "screen", onSelect }: BodyMapMarkerProps) {
  const cx = xNorm * VIEWBOX_WIDTH;
  const cy = yNorm * VIEWBOX_HEIGHT;
  const fill = variant === "print" ? "#000000" : "#004F71";

  function handleClick(event: MouseEvent<SVGGElement>) {
    // Stop the tap reaching BodyFigureSvg's own click handler -- selects
    // this marker instead of placing a new one on top of it.
    event.stopPropagation();
    onSelect?.();
  }

  return (
    <g onClick={variant === "screen" ? handleClick : undefined} style={{ cursor: onSelect ? "pointer" : undefined }}>
      {/* Invisible, larger-than-visible hit target -- a comfortable
          thumb touch area without inflating the printed/visible dot. */}
      {variant === "screen" && <circle cx={cx} cy={cy} r={22} fill="transparent" />}
      {isSelected && <circle cx={cx} cy={cy} r={18} fill="none" stroke={fill} strokeWidth={1.5} opacity={0.4} />}
      <circle cx={cx} cy={cy} r={13} fill={fill} stroke="#fff" strokeWidth={2.5} />
      <text x={cx} y={cy + 4.8} fontFamily="Quicksand,sans-serif" fontSize={14} fontWeight={700} fill="#ffffff" textAnchor="middle">
        {number}
      </text>
    </g>
  );
}
