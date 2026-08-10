"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { NarrativeField } from "../NarrativeField";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { AFLS_DOMAINS } from "@/lib/fba/types";
import type { AflsScoresData, AflsScoreValue, InstrumentItem } from "@/lib/fba/types";

const SCORE_OPTIONS: { value: AflsScoreValue; label: string }[] = [
  { value: "independent", label: "Independent" },
  { value: "assisted", label: "With assistance" },
  { value: "unable", label: "Unable" },
  { value: "na", label: "N/A" },
];

// Section 11: the full AFLS scoring tool. The item bank is fetched from
// fba_instruments (instrument_type='afls', one row per domain -- see
// migration 0040) rather than hardcoded, so replacing item text later is
// a data update, never a code change, per the brief.
export function AflsSection({
  scoresData,
  summary,
  onScoreChange,
  onSummaryChange,
  onSummaryBlur,
  readOnly,
}: {
  scoresData: AflsScoresData;
  summary: string;
  onScoreChange: (domain: string, itemId: string, score: AflsScoreValue) => void;
  onSummaryChange: (value: string) => void;
  onSummaryBlur: () => void;
  readOnly: boolean;
}) {
  const [itemsByDomain, setItemsByDomain] = useState<Record<string, InstrumentItem[]> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("fba_instruments")
      .select("items")
      .eq("instrument_type", "afls")
      .eq("is_active", true)
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error || !data) {
          setLoadError(true);
          return;
        }
        const grouped: Record<string, InstrumentItem[]> = {};
        for (const row of data as { items: InstrumentItem[] }[]) {
          for (const item of row.items) {
            const domain = item.category ?? "Other";
            grouped[domain] = grouped[domain] ? [...grouped[domain], item] : [item];
          }
        }
        setItemsByDomain(grouped);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  function toggleDomain(domain: string) {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  function scoreFor(domain: string, itemId: string): AflsScoreValue | null {
    return scoresData[domain]?.find((s) => s.itemId === itemId)?.score ?? null;
  }

  if (loadError) {
    return (
      <InlineErrorState
        message="Couldn't load the AFLS item bank."
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!itemsByDomain ? (
        <>
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </>
      ) : (
        AFLS_DOMAINS.map((domain) => {
          const items = itemsByDomain[domain] ?? [];
          const scored = scoresData[domain]?.length ?? 0;
          const total = items.length || 8;
          const isExpanded = expandedDomains.has(domain);

          return (
            <div key={domain} className="rounded-2xl border border-black/5 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => toggleDomain(domain)}
                className="flex w-full flex-col gap-2 p-4 text-left"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-brand-neutral-black">{domain}</span>
                  <span className="text-xs text-brand-neutral-black/50">
                    {scored}/{total}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                  <div
                    className="h-full rounded-full bg-brand-prussian-blue"
                    style={{ width: `${Math.round((scored / total) * 100)}%` }}
                  />
                </div>
              </button>

              {isExpanded && (
                <div className="flex flex-col gap-4 border-t border-black/5 px-4 pb-4 pt-3">
                  {items.map((item) => {
                    const current = scoreFor(domain, item.id);
                    return (
                      <div key={item.id}>
                        <p className="mb-2 text-sm text-brand-neutral-black">{item.text}</p>
                        <div className="grid grid-cols-2 gap-2">
                          {SCORE_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              disabled={readOnly}
                              onClick={() => onScoreChange(domain, item.id, option.value)}
                              className={`rounded-xl border px-2 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                                current === option.value
                                  ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                                  : "border-black/10 bg-white text-black/60"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      <div className="mt-2">
        <NarrativeField
          label="AFLS Summary"
          value={summary}
          onChange={onSummaryChange}
          onBlur={onSummaryBlur}
          readOnly={readOnly}
          rows={6}
          placeholder="Summarise the AFLS findings…"
        />
      </div>
    </div>
  );
}
