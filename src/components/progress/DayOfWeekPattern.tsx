import { HorizontalBarChart } from "@/components/clinician/fba/charts/HorizontalBarChart";
import { bestAndToughestWeekday, type WeekdayPatternEntry } from "@/lib/progress/regulation";
import type { ProgressViewerRole } from "@/lib/progress/types";

// Reuses HorizontalBarChart as-is (bar = settled count / total logged
// days, per weekday) -- no new bar primitive needed, this is exactly
// its existing BarDatum shape. The callout above it is the only
// role-branching point: warm framing for parents (constraint's own
// example, "Wednesdays tend to be great days"), factual for
// teacher/clinician. Purely descriptive -- a rate over the selected
// range, never a predicted "will be" statement (constraint 5).
export function DayOfWeekPattern({ pattern, role }: { pattern: WeekdayPatternEntry[]; role: ProgressViewerRole }) {
  const withData = pattern.filter((p) => p.totalCount > 0);
  if (withData.length === 0) return null;

  const { best, toughest } = bestAndToughestWeekday(pattern);
  const showComparison = best && toughest && best.weekday !== toughest.weekday;

  const bars = withData.map((entry) => ({
    label: entry.label,
    value: entry.settledCount,
    max: entry.totalCount,
  }));

  return (
    <div>
      {showComparison && (
        <p className="mb-3 text-sm text-brand-neutral-black/80">
          {role === "parent" ? (
            <>
              <span className="font-semibold text-brand-prussian-blue">{best!.label}s</span> tend to be great
              days. <span className="font-semibold">{toughest!.label}s</span> are a bit tougher, on average.
            </>
          ) : (
            <>
              Highest settled rate: <span className="font-semibold">{best!.label}</span> (
              {Math.round((best!.settledRate ?? 0) * 100)}%). Lowest: <span className="font-semibold">{toughest!.label}</span>{" "}
              ({Math.round((toughest!.settledRate ?? 0) * 100)}%).
            </>
          )}
        </p>
      )}
      <HorizontalBarChart bars={bars} valueLabel={(bar) => `${bar.value}/${bar.max} settled`} />
    </div>
  );
}
