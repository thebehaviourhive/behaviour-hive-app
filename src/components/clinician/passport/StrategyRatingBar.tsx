// Same single-full-width-bar, proportional-segments technique as
// RegulationStackedBar.tsx / AflsStackedBar.tsx: segments in a fixed
// order, count labels only shown in segments wide enough to hold them.
// Colors deliberately avoid red for "not" -- per the brief, both reds in
// this app already mean something else (regulation-state alerts, the
// Calm Button), and "not helping" is signal, not alarm. "Not" uses a
// muted, uncolored treatment instead, matching how AFLS/regulation mark
// "nothing alarming here" states elsewhere (absence of color, not a
// hue).
const SEGMENT_ORDER = ["helped", "partly", "not"] as const;
type SegmentKey = (typeof SEGMENT_ORDER)[number];

const SEGMENT_LABEL: Record<SegmentKey, string> = {
  helped: "Helped",
  partly: "A little",
  not: "Not this time",
};

const SEGMENT_CLASS: Record<SegmentKey, string> = {
  helped: "bg-brand-golden-brown",
  partly: "bg-brand-pastel-blue",
  not: "bg-brand-neutral-black/25",
};

export interface StrategyRatingCounts {
  helped: number;
  partly: number;
  not: number;
}

export function StrategyRatingBar({ counts, contextLabel }: { counts: StrategyRatingCounts; contextLabel: string }) {
  const total = counts.helped + counts.partly + counts.not;
  if (total === 0) return null;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-brand-neutral-black/70">{contextLabel}</span>
        <span className="text-xs text-brand-neutral-black/40">n={total}</span>
      </div>
      <div className="flex h-6 w-full overflow-hidden rounded-full border border-black/5 bg-white">
        {SEGMENT_ORDER.map((key) => {
          const count = counts[key];
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <div
              key={key}
              title={`${SEGMENT_LABEL[key]}: ${count}`}
              style={{ width: `${pct}%` }}
              className={`flex items-center justify-center ${SEGMENT_CLASS[key]}`}
            >
              {pct >= 15 && (
                <span
                  className={`text-[10px] font-bold ${key === "not" ? "text-brand-neutral-black/60" : "text-white"}`}
                >
                  {count}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Small shared legend, one row per rating value -- placed once per
// Effectiveness view (not per-bar) since the same three colors mean the
// same thing everywhere on the page.
export function StrategyRatingLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {SEGMENT_ORDER.map((key) => (
        <span key={key} className="flex items-center gap-1.5 text-xs text-brand-neutral-black/60">
          <span aria-hidden className={`h-2 w-2 rounded-full ${SEGMENT_CLASS[key]}`} />
          {SEGMENT_LABEL[key]}
        </span>
      ))}
    </div>
  );
}
