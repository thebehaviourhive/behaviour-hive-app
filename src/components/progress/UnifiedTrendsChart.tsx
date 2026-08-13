"use client";

import { useMemo, useState } from "react";
import {
  STATE_SCORE_MAX,
  STATE_SCORE_MIN,
  TREND_SERIES_META,
  REGULATION_STATE_COLOR,
  nearestState,
  seriesThresholdState,
  seriesUnlockHint,
  defaultActiveSeries,
  type TrendBucket,
  type WeekdayTrendBucket,
  type TrendSeriesId,
  type SeriesDataCounts,
} from "@/lib/progress/unifiedTrends";
import type { ProgressViewerRole } from "@/lib/progress/types";

// THE UNIFIED TRENDS GRAPH. Replaces the old incidents-over-time bars +
// incident day-of-week bars + regulation day-of-week bars with one
// multi-series SVG line graph (hand-rolled, no charting library --
// matches the rest of this codebase's chart approach). Two dual-axis
// options were on the table (brief's own wording): a true second numeric
// y-axis, or normalising regulation to its own labelled band. This
// takes the band: incidents keeps the one real numeric axis (left);
// regulation (1-3 state score) is mapped onto the SAME plot height as a
// normalised band, labelled by state name on the right rather than by
// number, so there is never a second competing number scale to misread
// at 375px -- reading the right edge tells you which state a line is
// near, not what value it "is" on some other axis.
//
// "No red line" rule (parent lens, constraint carried over from the
// regulation calendar/distribution chart): the morning-regulation LINE
// is always the fixed neutral colour from unifiedTrends.ts's
// TREND_SERIES_META, never state-coloured -- only the per-point MARKER
// takes the state colour, so a rough patch can never render as a solid
// red line across the graph.
//
// Interaction: no hover/crosshair (this is a touch-first surface, not a
// mouse one) -- instead this reuses RegulationCalendar's own established
// idiom, tap a point to reveal its detail in a panel below, rather than
// inventing a new hover-tooltip pattern for one chart.
const VB_W = 400;
const VB_H = 220;
const PAD_LEFT = 32;
const PAD_RIGHT = 74;
const PAD_TOP = 14;
const PAD_BOTTOM = 24;
const PLOT_W = VB_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VB_H - PAD_TOP - PAD_BOTTOM;

// The regulation band is deliberately inset a little further than the
// incidents axis's own full plot height: with two independently-scaled
// series sharing one plot area, a small incident max (e.g. 2) makes
// "2 incidents" and "Settled" land on the exact same pixel row purely
// by coincidence -- colour/legend still disambiguate which line is
// which, but this inset keeps the two scales' extremes from ever
// visually coinciding at all, which reads cleaner at 375px.
const REGULATION_INSET = 16;
const REGULATION_TOP = PAD_TOP + REGULATION_INSET;
const REGULATION_BOTTOM = VB_H - PAD_BOTTOM - REGULATION_INSET;

const REGULATION_AXIS_TICKS: { score: number; label: string }[] = [
  { score: 3, label: "Settled" },
  { score: 2, label: "Unsettled" },
  { score: 1, label: "Dysregulated" },
];

interface PlotPoint {
  key: string;
  label: string;
  detailLabel: string;
  incidents: number;
  incidentDetail: string;
  morning: number | null;
  morningDataDays: number;
  school: number | null;
  schoolDataDays: number;
  hasMarker: boolean;
}

function fromTrendBuckets(buckets: TrendBucket[]): PlotPoint[] {
  return buckets.map((b) => ({
    key: b.start,
    label: b.label,
    detailLabel: b.start === b.end ? b.label : `${b.label}`,
    incidents: b.incidentCount,
    incidentDetail: `${b.incidentCount} incident${b.incidentCount === 1 ? "" : "s"}`,
    morning: b.morningAvgState,
    morningDataDays: b.morningDataDays,
    school: b.schoolAvgState,
    schoolDataDays: b.schoolDataDays,
    hasMarker: b.hasStrategyMarker,
  }));
}

function fromWeekdayBuckets(buckets: WeekdayTrendBucket[]): PlotPoint[] {
  return buckets.map((b) => ({
    key: String(b.weekday),
    label: b.label,
    detailLabel: b.label,
    incidents: b.incidentAvg,
    incidentDetail:
      b.incidentOccurrences > 0
        ? `${b.incidentAvg.toFixed(1)} avg per ${b.label} (${b.incidentOccurrences} in range)`
        : "No data in range",
    morning: b.morningAvgState,
    morningDataDays: b.morningDataDays,
    school: b.schoolAvgState,
    schoolDataDays: b.schoolDataDays,
    hasMarker: false,
  }));
}

function regulationDetail(avg: number | null, dataDays: number): string {
  if (avg === null) return "No check-ins";
  const state = nearestState(avg);
  const label = state === "dysregulated" ? "Highly Dysregulated" : state === "unsettled" ? "Unsettled" : "Settled";
  return `mostly ${label} (avg ${avg.toFixed(1)}, ${dataDays} day${dataDays === 1 ? "" : "s"})`;
}

// Builds one or more "M.. L.." path segments, breaking at every null
// (gap) point rather than connecting across it -- constraint's own
// wording: "gaps for missing days rendered as breaks, not zeros".
function buildLinePath(points: { x: number; y: number | null }[]): string {
  const segments: string[] = [];
  let current: string[] = [];
  for (const p of points) {
    if (p.y === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(`${current.length === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }
  if (current.length > 1) segments.push(current.join(" "));
  return segments.join(" ");
}

function ChipToggle({
  seriesId,
  isActive,
  isEmpty,
  isSparse,
  periodLengthDays,
  dataDayCount,
  onToggle,
}: {
  seriesId: TrendSeriesId;
  isActive: boolean;
  isEmpty: boolean;
  isSparse: boolean;
  periodLengthDays: number;
  dataDayCount: number;
  onToggle: () => void;
}) {
  const meta = TREND_SERIES_META[seriesId];
  return (
    <div className="flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={isEmpty}
        aria-pressed={isActive}
        className={`flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          isActive
            ? "border-transparent bg-brand-off-white text-brand-neutral-black"
            : "border-black/10 bg-white text-brand-neutral-black/50"
        }`}
      >
        <span
          aria-hidden
          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ backgroundColor: meta.color, opacity: isActive ? 1 : 0.35 }}
        />
        {meta.label}
      </button>
      {isEmpty && <p className="pl-1 text-[10px] leading-tight text-brand-neutral-black/40">No data yet.</p>}
      {!isEmpty && isSparse && isActive && (
        <p className="pl-1 text-[10px] leading-tight text-brand-neutral-black/40">
          {seriesUnlockHint(dataDayCount, periodLengthDays)}
        </p>
      )}
    </div>
  );
}

export function UnifiedTrendsChart({
  role,
  buckets,
  weekdayBuckets,
  showSchoolSeries,
  seriesDataCounts,
  periodLengthDays,
}: {
  role: ProgressViewerRole;
  buckets: TrendBucket[];
  weekdayBuckets: WeekdayTrendBucket[];
  showSchoolSeries: boolean;
  seriesDataCounts: SeriesDataCounts;
  periodLengthDays: number;
}) {
  const [viewMode, setViewMode] = useState<"overTime" | "weekday">("overTime");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const visibleSeries: TrendSeriesId[] = useMemo(
    () => (["incidents", "morningRegulation", "schoolRegulation"] as TrendSeriesId[]).filter((id) => id !== "schoolRegulation" || showSchoolSeries),
    [showSchoolSeries]
  );

  const thresholdStates = useMemo(
    () => ({
      incidents: seriesThresholdState(seriesDataCounts.incidents, periodLengthDays),
      morningRegulation: seriesThresholdState(seriesDataCounts.morningRegulation, periodLengthDays),
      schoolRegulation: seriesThresholdState(seriesDataCounts.schoolRegulation, periodLengthDays),
    }),
    [seriesDataCounts, periodLengthDays]
  );

  const [activeSeries, setActiveSeries] = useState<Set<TrendSeriesId>>(() => {
    const defaults = defaultActiveSeries(role).filter(
      (id) => visibleSeries.includes(id) && thresholdStates[id] !== "empty"
    );
    if (defaults.length > 0) return new Set(defaults);
    // Every default series is empty (brand-new passport) -- fall back to
    // whichever visible series actually has data, if any, rather than
    // starting with nothing togglable at all.
    const fallback = visibleSeries.find((id) => thresholdStates[id] !== "empty");
    return new Set(fallback ? [fallback] : []);
  });

  function toggleSeries(id: TrendSeriesId) {
    setActiveSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size === 1) return prev; // at least one series always on
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const points = useMemo(
    () => (viewMode === "overTime" ? fromTrendBuckets(buckets) : fromWeekdayBuckets(weekdayBuckets)),
    [viewMode, buckets, weekdayBuckets]
  );

  const n = points.length;
  const x = (i: number) => PAD_LEFT + (n <= 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const incidentMax = Math.max(1, ...points.map((p) => p.incidents));
  const yIncidents = (v: number) => PAD_TOP + PLOT_H * (1 - v / incidentMax);
  const yRegulation = (score: number) =>
    REGULATION_TOP + (REGULATION_BOTTOM - REGULATION_TOP) * (1 - (score - STATE_SCORE_MIN) / (STATE_SCORE_MAX - STATE_SCORE_MIN));

  // Weekday mode's incidents series is an AVERAGE (decimals), not a raw
  // count, so the tick value itself can be fractional (e.g. 1.25) even
  // though its label should read as a clean "1.3" -- formatTick handles
  // that split between the real number driving the y-position and the
  // rounded text shown for it.
  const incidentTicks = incidentMax <= 1 ? [0, 1] : Array.from(new Set([0, incidentMax / 2, incidentMax]));
  const formatTick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  const labelStep = Math.max(1, Math.ceil(n / 6));

  const selected = selectedIndex !== null ? points[selectedIndex] : null;
  const markerBuckets = viewMode === "overTime" ? points.filter((p) => p.hasMarker) : [];

  const isIncidentsActive = activeSeries.has("incidents");
  const isMorningActive = activeSeries.has("morningRegulation");
  const isSchoolActive = activeSeries.has("schoolRegulation");

  const incidentLinePoints = points.map((p, i) => ({ x: x(i), y: yIncidents(p.incidents) }));
  const morningLinePoints = points.map((p, i) => ({ x: x(i), y: p.morning === null ? null : yRegulation(p.morning) }));
  const schoolLinePoints = points.map((p, i) => ({ x: x(i), y: p.school === null ? null : yRegulation(p.school) }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex rounded-full bg-black/5 p-1">
        {(["overTime", "weekday"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => {
              setViewMode(mode);
              setSelectedIndex(null);
            }}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              viewMode === mode ? "bg-white text-brand-prussian-blue shadow-sm" : "text-brand-neutral-black/50"
            }`}
          >
            {mode === "overTime" ? "Over time" : "By weekday"}
          </button>
        ))}
      </div>

      {n === 0 ? (
        <p className="text-sm text-brand-neutral-black/50">No data in this period.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full touch-manipulation" role="img" aria-label="Trends over time">
            {/* Regulation band gridlines + right-edge state labels */}
            {REGULATION_AXIS_TICKS.map((tick) => (
              <g key={tick.score}>
                <line
                  x1={PAD_LEFT}
                  x2={VB_W - PAD_RIGHT}
                  y1={yRegulation(tick.score)}
                  y2={yRegulation(tick.score)}
                  stroke="#000000"
                  strokeOpacity={0.06}
                  strokeDasharray="3,3"
                />
                <text x={VB_W - PAD_RIGHT + 6} y={yRegulation(tick.score) + 3} fontSize={9} fill="#22222399">
                  {tick.label}
                </text>
              </g>
            ))}

            {/* Incidents left axis ticks */}
            {incidentTicks.map((t) => (
              <text key={`tick-${t}`} x={PAD_LEFT - 6} y={yIncidents(t) + 3} fontSize={9} fill="#22222399" textAnchor="end">
                {formatTick(t)}
              </text>
            ))}

            {/* Strategy markers -- over-time mode only */}
            {markerBuckets.map((p) => {
              const i = points.indexOf(p);
              return (
                <line
                  key={p.key}
                  x1={x(i)}
                  x2={x(i)}
                  y1={PAD_TOP}
                  y2={VB_H - PAD_BOTTOM}
                  stroke="#D78825"
                  strokeWidth={1.5}
                  strokeDasharray="4,3"
                />
              );
            })}

            {/* Selected point guideline */}
            {selectedIndex !== null && (
              <line
                x1={x(selectedIndex)}
                x2={x(selectedIndex)}
                y1={PAD_TOP}
                y2={VB_H - PAD_BOTTOM}
                stroke="#004F71"
                strokeOpacity={0.25}
                strokeWidth={1.5}
              />
            )}

            {/* Incidents series */}
            {isIncidentsActive && thresholdStates.incidents === "confident" && (
              <path d={buildLinePath(incidentLinePoints)} fill="none" stroke={TREND_SERIES_META.incidents.color} strokeWidth={2} strokeLinecap="round" />
            )}
            {isIncidentsActive &&
              incidentLinePoints.map((p, i) => (
                <circle key={`inc-${i}`} cx={p.x} cy={p.y as number} r={4} fill={TREND_SERIES_META.incidents.color} stroke="white" strokeWidth={1} />
              ))}

            {/* Morning regulation series */}
            {isMorningActive && thresholdStates.morningRegulation === "confident" && (
              <path d={buildLinePath(morningLinePoints)} fill="none" stroke={TREND_SERIES_META.morningRegulation.color} strokeWidth={2} strokeLinecap="round" />
            )}
            {isMorningActive &&
              points.map(
                (p, i) =>
                  p.morning !== null && (
                    <circle
                      key={`morn-${i}`}
                      cx={x(i)}
                      cy={yRegulation(p.morning)}
                      r={4}
                      fill={REGULATION_STATE_COLOR[nearestState(p.morning)].hex}
                      stroke="white"
                      strokeWidth={1}
                    />
                  )
              )}

            {/* School regulation series */}
            {isSchoolActive && thresholdStates.schoolRegulation === "confident" && (
              <path d={buildLinePath(schoolLinePoints)} fill="none" stroke={TREND_SERIES_META.schoolRegulation.color} strokeWidth={2} strokeLinecap="round" strokeDasharray="0" />
            )}
            {isSchoolActive &&
              points.map(
                (p, i) =>
                  p.school !== null && (
                    <circle
                      key={`sch-${i}`}
                      cx={x(i)}
                      cy={yRegulation(p.school)}
                      r={3.5}
                      fill={REGULATION_STATE_COLOR[nearestState(p.school)].hex}
                      stroke={TREND_SERIES_META.schoolRegulation.color}
                      strokeWidth={1.5}
                    />
                  )
              )}

            {/* x-axis labels */}
            {points.map((p, i) =>
              i % labelStep === 0 || i === n - 1 ? (
                <text key={p.key} x={x(i)} y={VB_H - 6} fontSize={8.5} fill="#22222399" textAnchor="middle">
                  {p.label}
                </text>
              ) : null
            )}

            {/* Tap targets */}
            {points.map((_, i) => {
              const bandW = n <= 1 ? PLOT_W : PLOT_W / n;
              return (
                <rect
                  key={`tap-${i}`}
                  x={x(i) - bandW / 2}
                  y={PAD_TOP}
                  width={bandW}
                  height={PLOT_H}
                  fill="transparent"
                  onClick={() => setSelectedIndex(i)}
                  className="cursor-pointer"
                />
              );
            })}
          </svg>

          <div className="flex flex-wrap gap-2">
            {visibleSeries.map((id) => (
              <ChipToggle
                key={id}
                seriesId={id}
                isActive={activeSeries.has(id)}
                isEmpty={thresholdStates[id] === "empty"}
                isSparse={thresholdStates[id] === "sparse"}
                periodLengthDays={periodLengthDays}
                dataDayCount={seriesDataCounts[id]}
                onToggle={() => toggleSeries(id)}
              />
            ))}
          </div>

          {markerBuckets.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="h-2.5 w-4 flex-shrink-0 border-t-2 border-dashed border-brand-golden-brown" aria-hidden />
              <span className="rounded-full bg-brand-golden-brown/15 px-2 py-0.5 text-xs font-semibold text-brand-golden-brown">
                Strategies added: {markerBuckets.map((p) => p.label).join(", ")}
              </span>
            </div>
          )}

          {selected && (
            <div className="rounded-xl border border-black/5 bg-brand-off-white/40 p-3">
              <p className="text-sm font-semibold text-brand-neutral-black">{selected.detailLabel}</p>
              {isIncidentsActive && (
                <p className="mt-0.5 text-xs text-brand-neutral-black/60">Incidents: {selected.incidentDetail}</p>
              )}
              {isMorningActive && (
                <p className="text-xs text-brand-neutral-black/60">
                  Morning regulation: {regulationDetail(selected.morning, selected.morningDataDays)}
                </p>
              )}
              {isSchoolActive && showSchoolSeries && (
                <p className="text-xs text-brand-neutral-black/60">
                  School regulation: {regulationDetail(selected.school, selected.schoolDataDays)}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
