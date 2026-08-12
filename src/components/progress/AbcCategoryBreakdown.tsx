"use client";

import { useState } from "react";
import { ProgressPieChart } from "./ProgressPieChart";
import type { AbcCategoryKind, CategoryTally } from "@/lib/progress/abc";

const TABS: { key: AbcCategoryKind; label: string }[] = [
  { key: "antecedents", label: "Before" },
  { key: "behaviours", label: "Behaviour" },
  { key: "consequences", label: "After" },
];

// One tabbed pie chart rather than three stacked charts -- keeps the
// card compact at 375px. Segments are the real antecedent/behaviour/
// consequence option strings already on each log (see tallyCategory in
// lib/progress/abc.ts), never invented categories.
export function AbcCategoryBreakdown({
  tallies,
  onTabChange,
}: {
  tallies: Record<AbcCategoryKind, CategoryTally[]>;
  onTabChange?: (kind: AbcCategoryKind) => void;
}) {
  const [tab, setTab] = useState<AbcCategoryKind>("antecedents");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              onTabChange?.(t.key);
            }}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-brand-prussian-blue text-white"
                : "bg-brand-off-white text-brand-neutral-black/70"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <ProgressPieChart data={tallies[tab].map((t) => ({ label: t.label, count: t.count }))} />
    </div>
  );
}
