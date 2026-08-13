"use client";

import {
  useStrategyEffectivenessDetail,
  type StrategyEffectivenessRow,
  type StrategyItemType,
} from "@/hooks/useStrategyEffectivenessDetail";
import { MIN_RATINGS_FOR_CONFIDENCE, ratingSampleState, ratingsUnlockHint } from "@/lib/strategyEffectivenessThresholds";
import { StrategyRatingBar, StrategyRatingLegend } from "./StrategyRatingBar";
import { StrategyRatingSparkline } from "./StrategyRatingSparkline";
import { ProgressEmptyState } from "@/components/progress/ProgressEmptyState";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

const GROUP_ORDER: { key: StrategyItemType; title: string }[] = [
  { key: "strategy_home", title: "Home" },
  { key: "strategy_school", title: "School" },
  { key: "strategy_shared", title: "Shared" },
];

// "A quiet neutral marker (not red) on strategies trending 'not
// helping' at adequate sample size" -- adequate sample size reuses the
// same MIN_RATINGS_FOR_CONFIDENCE threshold as everything else on this
// view (one threshold, one meaning, not a second bespoke cutoff).
// "Trending not helping" is read descriptively, never as a
// recommendation: 'not' is simply the single largest of the three
// counts. No auto-recommendation copy, no clinical-judgment language --
// "the app counts, clinicians interpret" (brief's own constraint 1).
function isTrendingNotHelping(row: StrategyEffectivenessRow): boolean {
  if (row.totalRatings < MIN_RATINGS_FOR_CONFIDENCE) return false;
  const not = row.homeNot + row.schoolNot;
  const helped = row.homeHelped + row.schoolHelped;
  const partly = row.homePartly + row.schoolPartly;
  return not > helped && not > partly;
}

function StrategyEffectivenessCard({ row }: { row: StrategyEffectivenessRow }) {
  const sampleState = ratingSampleState(row.totalRatings);
  const homeCounts = { helped: row.homeHelped, partly: row.homePartly, not: row.homeNot };
  const schoolCounts = { helped: row.schoolHelped, partly: row.schoolPartly, not: row.schoolNot };
  const hasHome = row.homeHelped + row.homePartly + row.homeNot > 0;
  const hasSchool = row.schoolHelped + row.schoolPartly + row.schoolNot > 0;
  const trendingNotHelping = isTrendingNotHelping(row);

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-brand-neutral-black">{row.title || "Untitled"}</p>
        {trendingNotHelping && (
          <span className="flex-shrink-0 rounded-full border border-dashed border-brand-neutral-black/20 px-2 py-0.5 text-[10px] font-semibold text-brand-neutral-black/50">
            Trending: not helping
          </span>
        )}
      </div>

      {sampleState === "empty" && <p className="mt-2 text-sm text-brand-neutral-black/40">No ratings yet.</p>}

      {sampleState === "early" && (
        <div className="mt-2 mb-3">
          <ProgressEmptyState
            icon="🌱"
            title={`Early signal — ${row.totalRatings} rating${row.totalRatings === 1 ? "" : "s"}`}
            body={ratingsUnlockHint(row.totalRatings)}
            full={false}
          />
        </div>
      )}

      {sampleState !== "empty" && (
        <div className="mt-3 flex flex-col gap-3">
          {hasHome && <StrategyRatingBar counts={homeCounts} contextLabel="Home" />}
          {hasSchool && <StrategyRatingBar counts={schoolCounts} contextLabel="School" />}
        </div>
      )}

      {/* Sparkline only "where volume allows" -- reuses the same
          confidence threshold as the banner above, and needs at least 2
          points to draw a line at all. */}
      {sampleState === "confident" && row.ratingsTimeline.length >= 2 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-brand-neutral-black/40">Over time</p>
          <StrategyRatingSparkline timeline={row.ratingsTimeline} />
        </div>
      )}
    </div>
  );
}

function StrategyGroup({ title, rows }: { title: string; rows: StrategyEffectivenessRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-brand-neutral-black">{title}</p>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <StrategyEffectivenessCard key={row.strategyContentId} row={row} />
        ))}
      </div>
    </div>
  );
}

// Stage 3 -- "Layer 1: per-child effectiveness". Read-only, no auto-
// recommendations (brief's own words): this view counts and displays,
// it never tells a clinician what to do with a strategy. Grouped Home/
// School/Shared exactly as the passport's own Clinical Team section
// groups strategies, so the two views read as the same taxonomy.
export function EffectivenessSurface({ passportId }: { passportId: string }) {
  const { rows, isLoading, error, reload } = useStrategyEffectivenessDetail(passportId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (error) {
    return <InlineErrorState message={error} onRetry={reload} />;
  }

  if (!rows || rows.length === 0) {
    return (
      <ProgressEmptyState
        icon="📋"
        title="No strategies yet"
        body="Once recommendations are extracted from an approved FBA, they'll appear here with their ratings as they come in."
      />
    );
  }

  const byGroup = (key: StrategyItemType) => rows.filter((r) => r.itemType === key);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-black/5 bg-white/60 p-3">
        <StrategyRatingLegend />
      </div>
      {GROUP_ORDER.map(({ key, title }) => (
        <StrategyGroup key={key} title={title} rows={byGroup(key)} />
      ))}
    </div>
  );
}
