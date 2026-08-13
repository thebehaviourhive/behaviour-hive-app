import type { StrategyRatingsTimelinePoint } from "@/hooks/useStrategyEffectivenessDetail";

// No sparkline/mini-line-chart precedent exists anywhere in this
// codebase yet (the one line chart, UnifiedTrendsChart.tsx, is full-
// size). This is deliberately minimal rather than a scaled-down copy of
// that component: three fixed y-lanes (Helped/A little/Not, top to
// bottom) rather than a continuous numeric axis, since a rating is a
// categorical value, not a metric -- there's nothing to interpolate
// between "helped" and "not", so a lane-per-value dot plot reads
// honestly where a continuous line would silently imply an ordering/
// magnitude the data doesn't have. Same "not = muted, not red" rule as
// StrategyRatingBar.
const LANE_Y: Record<StrategyRatingsTimelinePoint["rating"], number> = {
  helped: 6,
  partly: 16,
  not: 26,
};

const DOT_CLASS: Record<StrategyRatingsTimelinePoint["rating"], string> = {
  helped: "fill-brand-golden-brown",
  partly: "fill-brand-pastel-blue",
  not: "fill-brand-neutral-black/40",
};

const WIDTH = 200;
const HEIGHT = 32;
const PADDING_X = 6;

export function StrategyRatingSparkline({ timeline }: { timeline: StrategyRatingsTimelinePoint[] }) {
  if (timeline.length < 2) return null;

  const usableWidth = WIDTH - PADDING_X * 2;
  const points = timeline.map((point, i) => ({
    x: PADDING_X + (timeline.length === 1 ? 0 : (usableWidth * i) / (timeline.length - 1)),
    y: LANE_Y[point.rating],
    rating: point.rating,
  }));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-8 w-full"
      role="img"
      aria-label="Ratings over time, oldest to newest"
    >
      <polyline
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="text-brand-neutral-black/15"
      />
      {points.map((p, i) => (
        // ratings_timeline has no stable id (it's a jsonb aggregate, not
        // rows with a key); order is stable within one fetch, which is
        // all this render needs.
        <circle key={i} cx={p.x} cy={p.y} r={2.5} className={DOT_CLASS[p.rating]} />
      ))}
    </svg>
  );
}
