"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { logAppEvent } from "@/lib/logAppEvent";

// Time-on-task instrumentation, Pass 2 -- the "how often people open
// the app, which surfaces they use" half. One insert per navigation,
// fire-and-forget, matching PreventPinchZoom's own shape as a mounted-
// once, renders-nothing sibling of {children} in the root layout. No
// third-party analytics library -- this writes to app_events directly.
export default function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    // logAppEvent sanitises the route internally -- pass the raw
    // pathname straight through.
    logAppEvent({ route: pathname, eventType: "page_view" });
  }, [pathname]);

  return null;
}
