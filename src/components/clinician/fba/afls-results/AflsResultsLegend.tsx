// Shared legend for the AFLS tracking grid -- appears with every
// results display (digital and print). Colour is never the only
// differentiator: unscored is dashed/empty, N/A is hatched with its
// own label, and the intensity swatches carry a numeric caption too,
// so every state still reads once a real grayscale printer strips
// colour out entirely.
const INTENSITY_STEPS = [0.25, 0.55, 1];

export function AflsResultsLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" role="list" aria-label="AFLS grid legend">
      <span role="listitem" className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-5 w-5 flex-shrink-0 rounded-md border border-dashed border-black/25 bg-transparent"
        />
        <span className="font-medium text-brand-neutral-black/70 print:text-black">Unscored</span>
      </span>

      {INTENSITY_STEPS.map((intensity) => (
        <span key={intensity} role="listitem" className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-5 w-5 flex-shrink-0 rounded-md border border-black/10"
            style={{ backgroundColor: `rgba(0, 79, 113, ${intensity})` }}
          />
          <span className="font-medium text-brand-neutral-black/70 print:text-black">
            {Math.round(intensity * 100)}%
          </span>
        </span>
      ))}

      <span role="listitem" className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-5 w-5 flex-shrink-0 rounded-md border border-black/20"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(34,34,35,0.28) 0, rgba(34,34,35,0.28) 1.5px, transparent 1.5px, transparent 5px)",
          }}
        />
        <span className="font-medium text-brand-neutral-black/70 print:text-black">N/A</span>
      </span>
    </div>
  );
}
