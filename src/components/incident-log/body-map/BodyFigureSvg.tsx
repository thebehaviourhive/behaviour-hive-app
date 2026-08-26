"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { VIEWBOX_HEIGHT, VIEWBOX_WIDTH, svgAssetPath } from "./bodyFigureData";
import type { BodyView, Side } from "./bodyMapRegions";

// These four files never change during a session -- fetch once, reuse.
const svgTextCache = new Map<string, string>();

export interface RegionTapInfo {
  elementId: string;
  region: string;
  side: Side;
}

interface BodyFigureSvgProps {
  view: BodyView;
  variant?: "screen" | "print";
  // The id of the currently-highlighted region path (before a tap is
  // confirmed), if any. Applying it is a class toggle on the real DOM
  // node -- see the effect below -- not a re-render of the figure.
  selectedElementId?: string | null;
  onRegionTap?: (info: RegionTapInfo, xNorm: number, yNorm: number) => void;
  children?: ReactNode;
}

// Renders the supplied SVG file exactly as provided -- fetched from
// public/body-map/ and injected raw, never redrawn or hand-transcribed.
// Tapping a path IS the region: the click handler below reads
// data-region/data-side straight off whichever element the browser's
// own hit-testing decided was tapped. There is no coordinate math
// deciding which region that is -- that's exactly what was broken in
// the version this replaces, and exactly what this design makes
// structurally impossible to get wrong again.
//
// Highlighting is a class toggle on the actual DOM node (.is-hover /
// .is-selected, already defined in the SVG's own embedded <style>), not
// a React re-render of the figure -- per the brief's own instruction.
//
// Sides are the child's own, already resolved by whoever built the
// source SVGs (front is mirrored to face the viewer, back is not) --
// this component reads data-side verbatim and never re-derives it.
export function BodyFigureSvg({ view, variant = "screen", selectedElementId, onRegionTap, children }: BodyFigureSvgProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const url = svgAssetPath(view, variant);
  // Lazy initializer, not an effect -- a cache hit is available
  // synchronously at render time, nothing to fetch. view/variant are
  // fixed per instance in this app (never swapped on an already-mounted
  // figure), so the effect below only ever needs to handle the
  // cache-miss (first-ever-fetch) path.
  const [svgText, setSvgText] = useState<string | null>(() => svgTextCache.get(url) ?? null);

  useEffect(() => {
    if (svgTextCache.has(url)) return;
    let isMounted = true;
    fetch(url)
      .then((res) => res.text())
      .then((text) => {
        if (!isMounted) return;
        svgTextCache.set(url, text);
        setSvgText(text);
      });
    return () => {
      isMounted = false;
    };
  }, [url]);

  // The fetched file carries its own fixed width="220" height="480" --
  // override to fill the responsive container it's placed in, without
  // touching anything else about the markup.
  useEffect(() => {
    const svgRoot = containerRef.current?.querySelector("svg");
    if (svgRoot) {
      svgRoot.style.width = "100%";
      svgRoot.style.height = "auto";
      svgRoot.style.display = "block";
    }
  }, [svgText]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.querySelectorAll(".is-selected").forEach((el) => el.classList.remove("is-selected"));
    if (selectedElementId) {
      root.querySelector(`#${CSS.escape(selectedElementId)}`)?.classList.add("is-selected");
    }
  }, [selectedElementId, svgText]);

  // dangerouslySetInnerHTML is diffed by React on the OBJECT reference it's
  // given, not by the __html string's own value -- a fresh `{ __html: ...}`
  // literal on every render (the obvious way to write this) makes React
  // reset node.innerHTML on every single re-render of this component, even
  // when svgText hasn't changed at all. That silently destroys and rebuilds
  // the entire injected figure -- wiping the .is-selected class the effect
  // above just applied, AND the width/height override the effect below
  // applies -- on any unrelated state change anywhere in this card (typing
  // a note, ticking a checkbox). Memoizing on svgText keeps the object
  // reference stable across renders where the content hasn't changed, so
  // React correctly leaves the committed DOM alone.
  const innerHtml = useMemo(() => (svgText !== null ? { __html: svgText } : undefined), [svgText]);

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!onRegionTap) return;
    const target = event.target as Element;
    const regionEl = target.closest(".bm-region");
    if (!regionEl) return;

    const region = regionEl.getAttribute("data-region");
    const side = regionEl.getAttribute("data-side") as Side | null;
    const elementId = regionEl.id;
    if (!region || !side || !elementId) return;

    const svgRoot = containerRef.current?.querySelector("svg");
    if (!svgRoot) return;
    const rect = svgRoot.getBoundingClientRect();
    const xNorm = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const yNorm = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));

    onRegionTap({ elementId, region, side }, xNorm, yNorm);
  }

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div
        ref={containerRef}
        role="img"
        aria-label={`Body map, ${view} view`}
        onClick={onRegionTap ? handleClick : undefined}
        style={{ cursor: onRegionTap ? "pointer" : undefined, width: "100%" }}
        // The fetched file's own bytes, untouched, from our own public/
        // directory -- never user input.
        dangerouslySetInnerHTML={innerHtml}
      />
      {children && (
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          {children}
        </svg>
      )}
    </div>
  );
}
