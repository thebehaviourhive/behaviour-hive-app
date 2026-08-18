// Shared brand-styled bar chart -- no charting library exists anywhere
// in this codebase (confirmed before building this), and the div-track-
// plus-fill idiom is already established inside the FBA module itself
// (AflsSection's per-domain progress bars), so this extends that same
// pattern rather than adding a dependency. Purely a display component --
// no fetching, no state -- so it's read-only by construction and reused
// as-is for Stage 3's completed/reader views.
export interface BarDatum {
  label: string;
  value: number;
  max: number;
}

export function HorizontalBarChart({
  bars,
  valueLabel,
}: {
  bars: BarDatum[];
  valueLabel?: (bar: BarDatum) => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {bars.map((bar) => {
        // max <= 0 means there's no valid denominator at all (e.g. the
        // QABF category where every item was marked excluded/"X") --
        // rendering a 0%-width bar here would read as a false "scored
        // zero" claim, so this renders as an inert "Not applicable" row
        // instead: label, no bar track, no value/max text. This is the
        // one state a caller can't express via `valueLabel` (which only
        // reformats a real value), so it's handled unconditionally here
        // rather than left for every caller to remember.
        if (bar.max <= 0) {
          return (
            <div key={bar.label}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-brand-neutral-black">{bar.label}</span>
                <span className="flex-shrink-0 text-sm font-medium italic text-brand-neutral-black/50">
                  Not applicable
                </span>
              </div>
            </div>
          );
        }

        const pct = Math.min(100, Math.round((bar.value / bar.max) * 100));
        return (
          <div key={bar.label}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-brand-neutral-black">{bar.label}</span>
              <span className="flex-shrink-0 text-sm font-semibold text-brand-prussian-blue">
                {valueLabel ? valueLabel(bar) : `${bar.value}/${bar.max}`}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/10">
              <div
                className="h-full rounded-full bg-brand-prussian-blue"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
