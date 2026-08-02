"use client";

import { useEffect } from "react";

/* iOS Safari's pinch-to-zoom fires as non-standard `gesture*` events that
   bypass `touch-action` entirely (WebKit only). This is the remaining
   piece needed to actually stop pinch-zoom on an installed iOS PWA, since
   the viewport meta tag's maximum-scale/user-scalable is ignored by iOS
   for accessibility reasons since iOS 10. */
export default function PreventPinchZoom() {
  useEffect(() => {
    const preventGesture = (event: Event) => event.preventDefault();
    const preventMultiTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };

    document.addEventListener("gesturestart", preventGesture);
    document.addEventListener("gesturechange", preventGesture);
    document.addEventListener("touchmove", preventMultiTouchMove, {
      passive: false,
    });

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("touchmove", preventMultiTouchMove);
    };
  }, []);

  return null;
}
