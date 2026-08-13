"use client";

import { useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { ClinicianBottomNav } from "@/components/clinician/ClinicianBottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ProgressEmptyState } from "@/components/progress/ProgressEmptyState";
import { RangeSelector } from "@/components/progress/RangeSelector";
import { type ProgressRangeKey } from "@/lib/progress/range";
import { useClinicianStrategyInsights, type InsightsSetting } from "@/hooks/useClinicianStrategyInsights";
import { StrategyTypeRankedCard } from "@/components/clinician/insights/StrategyTypeRankedCard";
import { StrategyTypeChildBreakdown } from "@/components/clinician/insights/StrategyTypeChildBreakdown";

// day-count filter reuses RangeSelector as-is (the app's one established
// period-filter control), minus its "custom" option -- a custom date
// range doesn't map cleanly onto the RPC's single p_period_days integer,
// and the brief only asks for "filter by ... time period", not a custom
// range specifically.
function rangeKeyToPeriodDays(key: ProgressRangeKey): number | null {
  if (key === "all") return null;
  return Number(key);
}

const SETTING_OPTIONS: { key: InsightsSetting; label: string }[] = [
  { key: null, label: "All" },
  { key: "home", label: "Home" },
  { key: "school", label: "School" },
];

// A sentinel distinguishing "no card expanded" from "the Untagged card
// is expanded" -- both would otherwise collapse onto the same falsy
// value (Untagged's own strategyTypeId is `null`). See
// useStrategyTypeChildBreakdown's own header comment for the matching
// convention on the fetch side.
type Selection = { strategyTypeId: string | null } | undefined;

// Stage 4 -- "Layer 2: caseload strategy insights". Aggregates across
// the clinician's OWN actively-linked cases only (query-enforced by
// both RPCs, re-checked live on every call -- a revoked case or an
// entirely different clinician's caseload never appears here, with no
// client-side scoping needed). Read-only, same "counts, never
// recommends" posture as Stage 3.
export default function ClinicianInsightsPage() {
  const { isReady } = useRequireRole("clinician");
  const [setting, setSetting] = useState<InsightsSetting>(null);
  const [rangeKey, setRangeKey] = useState<ProgressRangeKey>("all");
  const [selection, setSelection] = useState<Selection>(undefined);

  const periodDays = rangeKeyToPeriodDays(rangeKey);
  const { rows, isLoading, error, reload } = useClinicianStrategyInsights(setting, periodDays);

  if (!isReady) return null;

  function toggleSelection(strategyTypeId: string | null) {
    setSelection((prev) => (prev?.strategyTypeId === strategyTypeId ? undefined : { strategyTypeId }));
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-8 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-prussian-blue">Strategy Insights</h1>
        <p className="mt-1 text-sm text-brand-neutral-black/60">
          Across your active caseload. Ratings are signal, not proof — use them alongside your own judgment.
        </p>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-2">
        <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-3">
          <div className="flex flex-wrap gap-2">
            {SETTING_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setSetting(option.key)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  setting === option.key
                    ? "bg-brand-prussian-blue text-white"
                    : "bg-brand-off-white text-brand-neutral-black/70"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <RangeSelector value={rangeKey} onChange={setRangeKey} />
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-24 animate-pulse rounded-2xl bg-white" />
            <div className="h-24 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <InlineErrorState message={error} onRetry={reload} />
        ) : !rows || rows.length === 0 ? (
          <ProgressEmptyState
            icon="📊"
            title="No ratings yet"
            body="Once strategies across your caseload start getting rated, they'll be ranked here."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => {
              const isExpanded = selection?.strategyTypeId === row.strategyTypeId;
              return (
                <div key={row.strategyTypeId ?? "untagged"}>
                  <StrategyTypeRankedCard
                    row={row}
                    position={i + 1}
                    isExpanded={isExpanded}
                    onToggle={() => toggleSelection(row.strategyTypeId)}
                  />
                  {isExpanded && (
                    <StrategyTypeChildBreakdown
                      strategyTypeId={row.strategyTypeId}
                      setting={setting}
                      periodDays={periodDays}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <ClinicianBottomNav />
    </div>
  );
}
