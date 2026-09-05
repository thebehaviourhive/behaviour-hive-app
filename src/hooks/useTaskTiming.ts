"use client";

import { useState } from "react";

// Time-on-task instrumentation, Pass 1 (migration 0173). Shared by the
// four single-shot forms that record it directly on their own eventual
// row (incident stamp, EOD update, ABC log, morning check-in) -- stage
// two is a different, resumable shape and doesn't use this hook (see
// its own mark-once .update() calls on the incident detail page).
//
// Both values ride along on the form's own existing submission call --
// no new network round trip, no new table, nothing that can add
// latency to a real action. Collected for an internal efficiency
// report, not surfaced anywhere in-product -- see CLAUDE.md's
// TIME-ON-TASK INSTRUMENTATION entry.
//
// screenOpenedAt is a lazy useState initializer, not an effect -- it
// needs the instant this hook first runs (mount), which a lazy
// initializer gives synchronously, before paint, with no dependency
// array to get wrong.
//
// firstInputAt is set on the first call to markFirstInput() and never
// again. Wire it to a single onFocusCapture/onClickCapture on the
// form's own outermost element (captured, so it fires from one place
// regardless of which field the interaction lands on) rather than
// threading it through every individual field's own handler.
//
// onFirstInput (Pass 2) fires exactly once, at the genuine first-input
// moment -- the caller's own hook into logging a task_started app_event
// here rather than on mount. Deliberately NOT on mount: landing on a
// screen by accident must not count as a started task, or the
// abandonment rate this exists to measure gets inflated by noise that
// was never really an attempt. See migration 0174's own header.
export function useTaskTiming(onFirstInput?: () => void) {
  const [screenOpenedAt] = useState(() => new Date().toISOString());
  const [firstInputAt, setFirstInputAt] = useState<string | null>(null);

  function markFirstInput() {
    setFirstInputAt((prev) => {
      if (prev) return prev;
      onFirstInput?.();
      return new Date().toISOString();
    });
  }

  return { screenOpenedAt, firstInputAt, markFirstInput };
}
