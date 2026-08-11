"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatMicroSummary, scoreForItem, type DomainTally } from "@/lib/fba/aflsResults";
import { ScoreBadge } from "./ScoreBadge";
import type { AflsItemScore, InstrumentItem } from "@/lib/fba/types";

// LAYER 2, digital: eight accordion rows, one per domain. Collapsed by
// default (matches the input tool's own accordion convention); expanded
// shows a flat, borderless item list -- item text left, its score badge
// right, hairline dividers between rows.
export function AflsAccordionBreakdown({
  tallies,
  itemsByDomain,
  scoresData,
}: {
  tallies: DomainTally[];
  itemsByDomain: Record<string, InstrumentItem[]>;
  scoresData: Record<string, AflsItemScore[]>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(domain: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {tallies.map((tally) => {
        const items = itemsByDomain[tally.domain] ?? [];
        const scores = scoresData[tally.domain] ?? [];
        const isExpanded = expanded.has(tally.domain);
        return (
          <div key={tally.domain} className="rounded-2xl border border-black/5 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => toggle(tally.domain)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="font-heading text-sm font-bold text-brand-prussian-blue">{tally.domain}</p>
                <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                  {tally.isFullyUnscored ? "Unscored" : formatMicroSummary(tally)}
                </p>
              </div>
              <ChevronDown
                className={`h-4 w-4 flex-shrink-0 text-brand-neutral-black/40 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              />
            </button>

            {isExpanded && (
              <div className="divide-y divide-black/5 border-t border-black/5 px-4">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-2">
                    <p className="pr-4 font-sans text-sm text-brand-neutral-black">{item.text}</p>
                    <ScoreBadge value={scoreForItem(scores, item.id)} showLabel className="flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
