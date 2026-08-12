"use client";

import { useEffect } from "react";

// Screen Wake Lock API, feature-detected with a silent no-op fallback --
// no existing use of navigator.wakeLock anywhere in this codebase
// (confirmed before building this), so this is net new. FEASIBILITY (per
// constraint 2C, to report back): supported in iOS Safari/home-screen
// PWAs from iOS 16.4+, but has a documented history of releasing
// unexpectedly on some iOS point releases specifically in standalone
// (added-to-homescreen) mode, not just plain Safari tabs -- this hook
// re-acquires on visibilitychange (the standard recommended pattern for
// exactly that flakiness: a lock that silently dropped while
// backgrounded doesn't come back on its own). Treat this as "best
// effort, not guaranteed" on iOS, not a hard requirement the Calm flow
// depends on -- nothing here blocks or degrades the flow if it fails.
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let isCancelled = false;

    async function acquire() {
      try {
        sentinel = await (navigator as Navigator & { wakeLock: WakeLock }).wakeLock.request("screen");
      } catch (err) {
        // Expected on plenty of real devices/situations (unsupported,
        // battery saver, backgrounded tab) -- never surfaced to the user,
        // the flow works identically either way.
        console.warn("Screen wake lock unavailable:", err);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && !isCancelled) acquire();
    }

    acquire();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      sentinel?.release().catch(() => {});
    };
  }, [enabled]);
}

// Minimal ambient types -- the Wake Lock API isn't in this project's
// lib.dom.d.ts version yet.
interface WakeLockSentinel {
  release: () => Promise<void>;
}
interface WakeLock {
  request: (type: "screen") => Promise<WakeLockSentinel>;
}
