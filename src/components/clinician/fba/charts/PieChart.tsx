// Hand-rolled pie chart via a conic-gradient circle + a legend list --
// no charting library exists in this codebase. A legend is not optional
// decoration here: colour-only pie slices are hard to tell apart at
// 375px, so every slice's label and percentage are always spelled out
// in text underneath, never colour alone. Segments are the real
// categorical values already present in the data (e.g. the exact
// antecedent option strings from abc_logs) -- never invented buckets.
const PIE_PALETTE = [
  "#004F71", // brand prussian blue
  "#D78825", // brand golden brown
  "#3E7CB1", // mid blue
  "#5B8C5A", // muted green
  "#8E5572", // muted plum
  "#B0413E", // muted red
  "#6B5B95", // muted purple
  "#4C9F70", // teal green
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

export function PieChart({ data, emptyLabel }: { data: PieDatum[]; emptyLabel?: string }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return <p className="text-sm text-brand-neutral-black/50">{emptyLabel ?? "No data yet."}</p>;
  }

  // Builds cumulative start/end percentages via the reduce accumulator
  // itself rather than reassigning an outer variable inside the
  // callback -- functionally equivalent, but keeps every value scoped
  // to the reduce call instead of mutating captured render state.
  const segments = data.reduce<PieSegment[]>((acc, d, i) => {
    const start = acc.length > 0 ? acc[acc.length - 1].end : 0;
    const pct = (d.count / total) * 100;
    acc.push({ ...d, pct, color: PIE_PALETTE[i % PIE_PALETTE.length], start, end: start + pct });
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
