import Link from "next/link";
import { useStrategyTypeChildBreakdown } from "@/hooks/useStrategyTypeChildBreakdown";
import type { InsightsSetting } from "@/hooks/useClinicianStrategyInsights";
import { ratingSampleState, ratingsUnlockHint } from "@/lib/strategyEffectivenessThresholds";
import { StrategyRatingBar } from "@/components/clinician/passport/StrategyRatingBar";
import { ProgressEmptyState } from "@/components/progress/ProgressEmptyState";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// The per-child breakdown revealed when a ranked type card is tapped.
// Each child links straight into their own Clinical File's Effectiveness
// tab (?tab=effectiveness, read by the passport page -- see its own
// header comment) rather than just the file's default Summary tab, so
// the drill-down actually lands where the detail lives instead of
// making the clinician re-navigate once they arrive.
export function StrategyTypeChildBreakdown({
  strategyTypeId,
  setting,
  periodDays,
}: {
  strategyTypeId: string | null;
  setting: InsightsSetting;
  periodDays: number | null;
}) {
  const { rows, isLoading, error, reload } = useStrategyTypeChildBreakdown(strategyTypeId, setting, periodDays);

  if (isLoading) {
    return (
      <div className="mt-2 flex flex-col gap-2 px-1">
        <div className="h-16 animate-pulse rounded-xl bg-brand-off-white/60" />
        <div className="h-16 animate-pulse rounded-xl bg-brand-off-white/60" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2">
        <InlineErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="mt-2">
        <ProgressEmptyState icon="🔍" title="No ratings in this window" body="Try a wider time period." full={false} />
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-black/5 pt-3">
      {rows.map((row) => {
        const sampleState = ratingSampleState(row.ratingCount);
        return (
          <Link
            key={row.passportId}
            href={`/clinician/passport/${row.passportId}?tab=effectiveness`}
            className="rounded-xl border border-black/5 bg-brand-off-white/30 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-brand-neutral-black">{row.childName}</p>
              <span aria-hidden className="text-black/30">
                ›
              </span>
            </div>
            {sampleState === "early" ? (
              <p className="mt-1 text-xs text-brand-neutral-black/50">
                {row.ratingCount} rating{row.ratingCount === 1 ? "" : "s"} — {ratingsUnlockHint(row.ratingCount)}
              </p>
            ) : (
              <div className="mt-1.5">
                <StrategyRatingBar
                  counts={{ helped: row.helpedCount, partly: row.partlyCount, not: row.notCount }}
                  contextLabel={`n=${row.ratingCount}`}
                />
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}
