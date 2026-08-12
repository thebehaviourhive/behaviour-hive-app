import type { FrequencyBucket } from "@/lib/progress/abc";

// Same div-track-plus-fill bar idiom as HorizontalBarChart (the shared
// FBA chart), built as its own component rather than reused directly
// because it needs two things that generic {label,value,max} bars don't
// support: an incident-count max shared across all buckets (not each
// bar scaled to its own max, which would make every non-zero bar look
// equally "full"), and the strategy-marker overlay.
export function AbcFrequencyChart({
  buckets,
  strategyDates = [],
}: {
  buckets: FrequencyBucket[];
  strategyDates?: string[];
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="flex flex-col gap-3">
      {buckets.map((bucket) => {
        const pct = Math.round((bucket.count / max) * 100);
        const markerDate = strategyDates.find((d) => d >= bucket.start && d <= bucket.end);
        return (
          <div
            key={bucket.start}
            className={markerDate ? "border-l-4 border-dashed border-brand-golden-brown pl-2" : ""}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-brand-neutral-black">{bucket.label}</span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-prussian-blue">
                {markerDate && (
                  <span className="rounded-full bg-brand-golden-brown/15 px-2 py-0.5 text-xs font-semibold text-brand-golden-brown">
                    Strategies added
                  </span>
                )}
                {bucket.count}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-brand-prussian-blue" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
