// Same hand-rolled conic-gradient-plus-legend technique as
// clinician/fba/charts/PieChart.tsx (no charting library exists in this
// codebase) -- a separate component rather than reusing that one
// directly, because its palette's 2nd/6th slices are Golden Brown and a
// muted red, both reserved elsewhere in Progress (constraint 3: Golden
// Brown only for the strategy marker/positive highlights, red only for
// the regulation-state dot). This palette stays entirely within brand
// blues + neutral greys so a categorical breakdown can never accidentally
// read as an alert or a "strategy" highlight.
const PROGRESS_PIE_PALETTE = [
  "#004F71", // brand prussian blue
  "#BAD9EB", // brand pastel blue
  "#3E7CB1", // mid blue
  "#7A8B99", // muted slate
  "#5B7A8C", // steel blue
  "#9FB4C2", // pale steel
];

export interface PieDatum {
  label: string;
  count: number;
}

interface PieSegment extends PieDatum {
  pct: number;
  color: string;
  start: number;
  end: number;
}

export function ProgressPieChart({ data, emptyLabel }: { data: PieDatum[]; emptyLabel?: string }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return <p className="text-sm text-brand-neutral-black/50">{emptyLabel ?? "No data yet."}</p>;
  }

  const segments = data.reduce<PieSegment[]>((acc, d, i) => {
    const start = acc.length > 0 ? acc[acc.length - 1].end : 0;
    const pct = (d.count / total) * 100;
    acc.push({ ...d, pct, color: PROGRESS_PIE_PALETTE[i % PROGRESS_PIE_PALETTE.length], start, end: start + pct });
    return acc;
  }, []);

  const stops = segments.map((s) => `${s.color} ${s.start}% ${s.end}%`);

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        aria-hidden
        className="h-36 w-36 flex-shrink-0 rounded-full"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
      />
      <ul className="flex w-full flex-col gap-1.5">
        {segments.map((seg) => (
          <li key={seg.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: seg.color }}
            />
            <span className="flex-1 text-brand-neutral-black">{seg.label}</span>
            <span className="flex-shrink-0 font-semibold text-brand-neutral-black/70">
              {Math.round(seg.pct)}% ({seg.count})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
