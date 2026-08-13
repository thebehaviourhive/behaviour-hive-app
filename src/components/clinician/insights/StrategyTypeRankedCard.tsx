import type { StrategyTypeInsightRow } from "@/hooks/useClinicianStrategyInsights";
import { ratingSampleState, ratingsUnlockHint } from "@/lib/strategyEffectivenessThresholds";
import { StrategyRatingBar } from "@/components/clinician/passport/StrategyRatingBar";
import { ProgressEmptyState } from "@/components/progress/ProgressEmptyState";

function pct(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

// One row of the ranked list -- position, label, headline counts, the
// same 3-segment bar as Stage 3's per-child Effectiveness view (reused
// as-is, not re-implemented), and the home/school split from the
// brief's own worked example ("Home 71% / School 82%"), shown only for
// whichever context(s) actually have data -- same "where both contexts
// have data" convention as Stage 3.
export function StrategyTypeRankedCard({
  row,
  position,
  isExpanded,
  onToggle,
}: {
  row: StrategyTypeInsightRow;
  position: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const sampleState = ratingSampleState(row.ratingCount);
  const helpedPct = pct(row.helpedCount, row.ratingCount);
  const hasHome = row.homeRatingCount > 0;
  const hasSchool = row.schoolRatingCount > 0;
  const isUntagged = row.strategyTypeId === null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition-colors ${
        isExpanded ? "border-brand-prussian-blue" : "border-black/5"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-pastel-blue/30 text-xs font-bold text-brand-prussian-blue">
          {position}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-brand-neutral-black">{row.strategyTypeLabel}</p>
          <p className="mt-0.5 text-xs text-brand-neutral-black/50">
            {row.childCount} {row.childCount === 1 ? "child" : "children"} · {row.ratingCount}{" "}
            {row.ratingCount === 1 ? "rating" : "ratings"}
          </p>

          {sampleState === "empty" ? null : sampleState === "early" ? (
            <div className="mt-2">
              <ProgressEmptyState
                icon="🌱"
                title={`Early signal — ${row.ratingCount} rating${row.ratingCount === 1 ? "" : "s"}`}
                body={ratingsUnlockHint(row.ratingCount)}
                full={false}
              />
            </div>
          ) : (
            <>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1">
                  <StrategyRatingBar
                    counts={{ helped: row.helpedCount, partly: row.partlyCount, not: row.notCount }}
                    contextLabel={`${helpedPct}% helped`}
                  />
                </div>
              </div>
              {(hasHome || hasSchool) && (
                <p className="mt-2 text-xs text-brand-neutral-black/60">
                  {hasHome && `Home ${pct(row.homeHelpedCount, row.homeRatingCount)}% (n=${row.homeRatingCount})`}
                  {hasHome && hasSchool && "  ·  "}
                  {hasSchool &&
                    `School ${pct(row.schoolHelpedCount, row.schoolRatingCount)}% (n=${row.schoolRatingCount})`}
                </p>
              )}
            </>
          )}

          {isUntagged && (
            <p className="mt-2 text-xs italic text-brand-neutral-black/40">
              💡 Tagging these strategies at authoring unlocks clearer, named insights.
            </p>
          )}
        </div>
        <span aria-hidden className={`mt-1 flex-shrink-0 text-black/30 transition-transform ${isExpanded ? "rotate-90" : ""}`}>
          ›
        </span>
      </div>
    </button>
  );
}
