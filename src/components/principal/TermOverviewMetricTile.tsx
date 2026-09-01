import { TrendUpIcon } from "@/components/ui/icons";
import type { Trend } from "@/lib/termOverviewFormatting";

// PRD 4, Stage 6. TrendUpIcon rotated 180deg stands in for "down" --
// there's no separate down-arrow icon in this set, and rotating the one
// arrow this app already has avoids adding a near-duplicate SVG for a
// single stage. Falling (down) is Prussian Blue -- good news, fewer
// incidents/restraints; rising (up) is neutral dark grey, never red --
// PRD 4's own "no red anywhere, trends without red" rule. "flat"/"new"
// get no arrow at all -- an arrow implies a direction, and neither of
// those states has one.
export function TermOverviewMetricTile({
  label,
  value,
  trend,
  caption,
}: {
  label: string;
  value: number;
  trend?: Trend;
  caption?: string;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">{label}</p>
      <p className="mt-1 font-heading text-h1 font-bold text-brand-prussian-blue">{value}</p>
      {trend && (
        <p
          className={`mt-1 flex items-center gap-1 font-sans text-eyebrow font-semibold ${
            trend.direction === "down" ? "text-brand-prussian-blue" : "text-brand-neutral-black/60"
          }`}
        >
          {trend.direction === "down" && <TrendUpIcon className="h-3.5 w-3.5 rotate-180" />}
          {trend.direction === "up" && <TrendUpIcon className="h-3.5 w-3.5" />}
          {trend.label}
        </p>
      )}
      {caption && <p className="mt-1 font-sans text-eyebrow text-brand-neutral-black/50">{caption}</p>}
    </div>
  );
}
