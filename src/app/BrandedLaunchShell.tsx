"use client";

import { useEffect, useState } from "react";

// PWA cold-start fix -- the "inline branded shell". Rendered directly
// in layout.tsx, which has no auth/role gate of its own, so this is
// part of the FIRST HTML the browser receives: it's visually correct
// (full-screen, Prussian Blue, logo, pulsing) from the raw SSR'd
// markup alone, via plain inline styles and a <style> tag -- no
// JavaScript has to run for it to look right, and the logo is inlined
// SVG, not an <img> fetch, so there's zero network dependency either.
// This is what replaces the white flash: the moment between "browser
// has HTML" and "hydration + the destination page's own content is
// ready" now shows this instead of a bare white body.
//
// Once React hydrates, this component's own effect fades it out and
// then unmounts it -- "replaced seamlessly when the app hydrates".
//
// Deliberate scope boundary (not a restructure this weekend): this
// covers the PRE-hydration gap fully, which is the larger of the two
// gaps (JS bundle download + parse + execute). It does NOT stay
// visible through the SHORTER post-hydration gap every
// useRequireRole-gated page has (its own async auth-check, rendering
// null client-side for a moment) -- wiring a shared "content ready"
// signal through every gated page is real, in-scope work for after
// the demo, not a cheap weekend fix. That window is still safe: it's
// covered by the Prussian Blue default in globals.css's `body` rule,
// so the absolute worst case is a brief on-brand blank, never white.
export default function BrandedLaunchShell() {
  const [isVisible, setIsVisible] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    // Two ticks, not one: mounting already-faded would mean the very
    // first client-rendered frame doesn't match the SSR'd (fully
    // opaque) markup, which either skips the transition entirely or
    // reads as a flash rather than a fade. Triggering the fade on the
    // NEXT frame guarantees the browser paints the opaque state at
    // least once before animating away from it.
    const raf = requestAnimationFrame(() => setIsFadingOut(true));
    // Matches the 400ms CSS transition below, plus a small margin --
    // this only removes the (by then invisible, pointer-events-none)
    // node from the DOM, it doesn't drive the fade itself.
    const removeTimer = setTimeout(() => setIsVisible(false), 500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#004F71",
        opacity: isFadingOut ? 0 : 1,
        transition: "opacity 400ms ease",
        pointerEvents: isFadingOut ? "none" : "auto",
      }}
    >
      <svg viewBox="0 0 100 100" width="72" height="72" style={{ animation: "brandedLaunchPulse 1.6s ease-in-out infinite" }}>
        <path
          d="M20.00,16.00 Q20.00,7.00 29.00,7.00 L52.00,7.00 Q61.00,7.00 67.36,13.36 L73.64,19.64 Q80.00,26.00 80.00,35.00 L80.00,84.00 Q80.00,93.00 71.00,93.00 L29.00,93.00 Q20.00,93.00 20.00,84.00 Z"
          fill="#FFFFFF"
        />
        <path
          d="M61.82,11.08 Q61.82,8.65 63.54,10.36 L76.64,23.46 Q78.35,25.18 75.92,25.18 L64.25,25.18 Q61.82,25.18 61.82,22.75 Z"
          fill="#D78825"
        />
        <rect x="34.40" y="77.00" width="31.20" height="3.40" rx="1.70" fill="#D78825" />
        <path
          d="M54.05,35.34 Q50.00,33.00 45.95,35.34 L38.46,39.66 Q34.41,42.00 34.41,46.68 L34.41,55.32 Q34.41,60.00 38.46,62.34 L45.95,66.66 Q50.00,69.00 54.05,66.66 L61.54,62.34 Q65.59,60.00 65.59,55.32 L65.59,46.68 Q65.59,42.00 61.54,39.66 Z"
          fill="#D78825"
        />
      </svg>
      <style>{`
        @keyframes brandedLaunchPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.94); }
        }
      `}</style>
    </div>
  );
}
