"use client";

import { useEffect, useState } from "react";

// Reactive counterpart to the one-off `window.matchMedia("(min-width:
// 1024px)").matches` click-time checks ClassesList/ChildrenList already
// use to decide navigation behaviour. Those don't need re-render on
// resize -- they're read once, at click time. This hook is for the
// different problem Directory's Clinicians segment ran into: rendering
// the SAME detail component in two different places (a `lg:hidden`
// mobile slot stacked under the list, a `hidden lg:block` desktop slot
// beside it) and needing exactly ONE of them mounted at a time, not
// both simultaneously with the other merely CSS-hidden -- two mounted
// copies of one component means duplicate DOM ids (checkbox/label
// pairs, form elements), found live during browser verification.
// lg = 1024px, matching this app's own Tailwind breakpoint.
export function useIsDesktopWidth(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    function sync() {
      setIsDesktop(mql.matches);
    }
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  return isDesktop;
}
