import { AFLS_CELL_COLORS } from "@/lib/fba/aflsResults";

// CHANGE 2 (2026-08-21): replaces the old Prussian-intensity-ramp
// legend entirely with the four clinical traffic-light entries, exact
// copy per the brief. Colours pulled from AFLS_CELL_COLORS (shared
// with AflsResultsGrid) so the swatches and the actual cell fills can
// never drift apart.
//
// Note: the brief's four entries don't include "Unscored" (the grid's
// dashed-empty state, unchanged by this brief) -- flagged to the user
// rather than silently re-adding a 5th entry or silently dropping
// unscored's own visual explanation from the key.
const LEGEND_ENTRIES: { color: string; label: string }[] = [
  { color: AFLS_CELL_COLORS.na, label: "N/A" },
  { color: AFLS_CELL_COLORS.zero, label: "Cannot Do" },
  { color: AFLS_CELL_COLORS.max, label: "Independent" },
  { color: AFLS_CELL_COLORS.mid, label: "Requires Supervision/Prompting" },
];

export function AflsResultsLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" role="list" aria-label="AFLS grid legend">
      {LEGEND_ENTRIES.map((entry) => (
        <span key={entry.label} role="listitem" className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-5 w-5 flex-shrink-0 rounded-md border border-black/10"
            style={{ backgroundColor: entry.color }}
          />
          <span className="font-medium text-brand-neutral-black/70 print:text-black">{entry.label}</span>
        </span>
      ))}
    </div>
  );
}
