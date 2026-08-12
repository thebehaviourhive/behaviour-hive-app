"use client";

import { useState } from "react";
import { format } from "date-fns";
import {
  REGULATION_STATE_COLOR,
  REGULATION_STATE_LABEL,
  type CalendarDay,
} from "@/lib/progress/regulation";
import { weekdayIndex, WEEKDAY_SHORT_LABELS } from "@/lib/progress/dateUtils";

// Chart 1. No time-series/line-chart primitive exists anywhere in this
// codebase to reuse (only date-range-bucketed bar charts -- see
// DailyPatternsPanel) -- rather than build a novel axis-based line
// chart from scratch, this follows the brief's own offered alternative
// ("time series/calendar-style view"): a calendar-grid heatmap, day
// cells colour-coded by state. Inherently touch-friendly at 375px
// (tap a cell for its detail below), and scales cleanly across
// 7/30/90/all by simply growing more rows -- no axis/scale math needed.
//
// Each cell is split top/bottom -- morning check-in colour on top,
// afternoon EOD colour on bottom -- satisfying "paired view" for all
// three roles at once (which series exist is entirely a data-presence
// question already governed by RLS, not a role branch in this
// component).
function StateHalf({ state, position }: { state: "settled" | "unsettled" | "dysregulated" | null; position: "top" | "bottom" }) {
  const cls = state ? REGULATION_STATE_COLOR[state].dot : "bg-black/[0.06]";
  return (
    <div
      className={`h-1/2 w-full ${cls} ${position === "top" ? "rounded-t-[3px]" : "rounded-b-[3px]"}`}
    />
  );
}

export function RegulationCalendar({
  days,
  hasAfternoonData,
  strategyDates = [],
}: {
  days: CalendarDay[];
  hasAfternoonData: boolean;
  strategyDates?: string[];
}) {
  const [selected, setSelected] = useState<CalendarDay | null>(null);

  if (days.length === 0) return null;

  // Pad the front of the grid so the first real day lands in its true
  // weekday column -- a genuine calendar layout, not just N cells in a
  // row. Sunday-first, matching Date#getDay()'s own 0-index.
  const leadingBlanks = weekdayIndex(days[0].date);
  const cells: (CalendarDay | null)[] = [...Array(leadingBlanks).fill(null), ...days];

  return (
    <div>
      <div className="mb-1.5 grid grid-cols-7 gap-1">
        {WEEKDAY_SHORT_LABELS.map((label) => (
          <p key={label} className="text-center font-accent text-[10px] font-bold uppercase text-brand-neutral-black/40">
            {label[0]}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`blank-${i}`} aria-hidden />;
          const isMarker = strategyDates.includes(day.date);
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => setSelected(day)}
              aria-label={`${format(new Date(`${day.date}T00:00:00`), "d MMM yyyy")}${day.morning ? `, morning ${day.morning}` : ""}${isMarker ? ", strategies added this day" : ""}`}
              className={`h-8 w-full overflow-hidden rounded-[3px] border-2 transition-transform active:scale-90 ${
                isMarker
                  ? "border-dashed border-brand-golden-brown"
                  : selected?.date === day.date
                    ? "border-solid border-brand-prussian-blue"
                    : "border-solid border-black/5"
              }`}
            >
              <StateHalf state={day.morning} position="top" />
              <StateHalf state={day.afternoon} position="bottom" />
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {(["settled", "unsettled", "dysregulated"] as const).map((state) => (
          <div key={state} className="flex items-center gap-1.5">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${REGULATION_STATE_COLOR[state].dot}`} />
            <span className="text-xs text-brand-neutral-black/60">{REGULATION_STATE_LABEL[state]}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-black/[0.06]" />
          <span className="text-xs text-brand-neutral-black/60">No check-in</span>
        </div>
        {strategyDates.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] border-2 border-dashed border-brand-golden-brown" />
            <span className="text-xs text-brand-neutral-black/60">Strategies added</span>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs text-brand-neutral-black/40">
        Top half of each day: morning check-in. Bottom half: {hasAfternoonData ? "afternoon update from school." : "afternoon update (none yet)."}
      </p>

      {selected && (
        <div className="mt-3 rounded-xl border border-black/5 bg-brand-off-white/40 p-3">
          <p className="text-sm font-semibold text-brand-neutral-black">
            {format(new Date(`${selected.date}T00:00:00`), "EEEE d MMMM yyyy")}
          </p>
          <p className="mt-0.5 text-xs text-brand-neutral-black/60">
            Morning: {selected.morning ? REGULATION_STATE_LABEL[selected.morning] : "No check-in"}
          </p>
          <p className="text-xs text-brand-neutral-black/60">
            Afternoon: {selected.afternoon ? REGULATION_STATE_LABEL[selected.afternoon] : "No update"}
          </p>
          {strategyDates.includes(selected.date) && (
            <p className="mt-1.5 inline-block rounded-full bg-brand-golden-brown/15 px-2 py-0.5 text-xs font-semibold text-brand-golden-brown">
              Strategies added this day
            </p>
          )}
        </div>
      )}
    </div>
  );
}
