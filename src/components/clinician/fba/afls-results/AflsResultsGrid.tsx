"use client";

import { useState } from "react";
import { useAflsItemBank } from "@/hooks/useAflsItemBank";
import { AFLS_DOMAINS } from "@/lib/fba/types";
import {
  AFLS_CELL_COLORS,
  cellStateFor,
  cellTierFor,
  computeDomainPoints,
  formatDomainSummary,
  isAflsResultsEmpty,
  type AflsScoreTier,
} from "@/lib/fba/aflsResults";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { FbaNote } from "../FbaNote";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { AflsResultsLegend } from "./AflsResultsLegend";
import type { AflsAssessment, AflsTaskScore, InstrumentItem } from "@/lib/fba/types";

// AFLS RESULTS: THE MOBILE TRACKING GRID (STEP 3). Models the paper
// protocol's own Skills Tracking System: per-domain compact cell grids,
// one cell per task, fill intensity = score/maxScore. Replaces the
// honeycomb print figure AND the stacked-bar digital view entirely --
// one shared component for both, `isPrint` only changing layout/
// interactivity, exactly the same 375px-first posture the rest of this
// module already uses (see FbaSectionsReadOnly's own isPrint prop).
// CHANGE 1 (2026-08-21): text colour is chosen per swatch for
// legibility, never by tempering the four specified hexes themselves.
// White on dark green measures ~7.4:1 contrast; black everywhere else,
// INCLUDING on the red -- black-on-#FF0000 measures ~5.3:1 (clears
// WCAG AA's 4.5:1 for this cell's small bold text), where white-on-red
// would only measure ~4.0:1, marginally short of AA. So red keeps its
// exact hex and just gets black text instead.
function selectedCellClasses(
  state: ReturnType<typeof cellStateFor>,
  tier: AflsScoreTier | null
): { style?: React.CSSProperties; className: string } {
  if (state === "unscored") {
    return { className: "border border-dashed border-black/25 bg-transparent text-brand-neutral-black/40" };
  }
  if (state === "na") {
    return { className: "border border-black/10 text-black", style: { backgroundColor: AFLS_CELL_COLORS.na } };
  }
  // Scored: exactly one of three discrete traffic-light tiers, never a
  // continuous ramp. "zero" and "max" are the two clinically
  // load-bearing extremes (cannot do vs. independent) -- also why
  // AflsCell layers a shape glyph on top of them: their grayscale luma
  // (~0.30 vs ~0.23) sits close enough that colour alone isn't a safe
  // distinguisher on a black-and-white print, where mixing up "fail"
  // and "independent" would be a real clinical-reading error.
  if (tier === "zero") {
    return { className: "border border-black/10 text-black", style: { backgroundColor: AFLS_CELL_COLORS.zero } };
  }
  if (tier === "max") {
    return { className: "border border-black/10 text-white", style: { backgroundColor: AFLS_CELL_COLORS.max } };
  }
  return { className: "border border-black/10 text-black", style: { backgroundColor: AFLS_CELL_COLORS.mid } };
}

function AflsCell({
  item,
  score,
  onTap,
}: {
  item: InstrumentItem;
  score: AflsTaskScore | undefined;
  onTap: () => void;
}) {
  const state = cellStateFor(score);
  const tier = state === "scored" ? cellTierFor(score as number, item.maxScore ?? 0) : null;
  const { className, style } = selectedCellClasses(state, tier);
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${item.id}: ${item.text} -- ${
        state === "unscored" ? "not yet scored" : state === "na" ? "N/A" : `${score}/${item.maxScore}`
      }`}
      className={`relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-[8.5px] font-bold leading-none transition-colors ${className}`}
      style={style}
    >
      {item.id}
      {/* Shape glyph, redundant with colour -- see selectedCellClasses'
          comment. aria-hidden since the button's own aria-label
          already states the score/state in words. */}
      {tier === "zero" && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-white text-[7px] font-black leading-none text-red-700 ring-1 ring-black/10"
        >
          ✕
        </span>
      )}
      {tier === "max" && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-white text-[7px] font-black leading-none text-green-800 ring-1 ring-black/10"
        >
          ✓
        </span>
      )}
    </button>
  );
}

function AflsDomainCard({
  domainCode,
  domainName,
  items,
  scores,
  isPrint,
  onCellTap,
}: {
  domainCode: string;
  domainName: string;
  items: InstrumentItem[];
  scores: Record<string, AflsTaskScore>;
  isPrint: boolean;
  onCellTap: (item: InstrumentItem) => void;
}) {
  const points = computeDomainPoints(domainCode, items, scores);
  return (
    <div
      className={`rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm print:rounded-none print:border-black/20 print:shadow-none ${
        isPrint ? "print-avoid-break" : ""
      }`}
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <p className="font-heading text-sm font-bold text-brand-prussian-blue print:text-black">{domainName}</p>
        <p className="flex-shrink-0 text-xs text-brand-neutral-black/50 print:text-black">
          {formatDomainSummary(points)}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <AflsCell key={item.id} item={item} score={scores[item.id]} onTap={() => onCellTap(item)} />
        ))}
      </div>
    </div>
  );
}

export function AflsResultsGrid({ assessments, isPrint = false }: { assessments: AflsAssessment[]; isPrint?: boolean }) {
  const { itemsByDomain, loadError } = useAflsItemBank();
  // Most recent first (the hook's own sort) -- index 0 is the default,
  // matching "defaults to the most recent assessment" exactly.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ item: InstrumentItem; score: AflsTaskScore | undefined } | null>(
    null
  );

  if (loadError) {
    return <InlineErrorState message="Couldn't load the AFLS item bank." onRetry={() => window.location.reload()} />;
  }

  if (assessments.length === 0 || isAflsResultsEmpty(assessments)) {
    return <FbaNote>No AFLS assessment recorded yet.</FbaNote>;
  }

  if (!itemsByDomain) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-16 animate-pulse rounded-2xl bg-white" />
        <div className="h-16 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  // Print always shows the single most recent assessment, statically --
  // no selector, no interactivity, matches every other print surface
  // in this module.
  const assessment = isPrint ? assessments[0] : (assessments[selectedIndex] ?? assessments[0]);

  return (
    <div className="flex flex-col gap-4">
      <AflsResultsLegend />

      {!isPrint && assessments.length > 1 && (
        <div>
          <label className="mb-1 block text-xs font-semibold text-brand-neutral-black/60">Viewing assessment</label>
          <select
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          >
            {assessments.map((a, i) => (
              <option key={a.id} value={i}>
                {a.assessmentDate}
                {a.assessorName ? ` · ${a.assessorName}` : ""}
                {i === 0 ? " (most recent)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* print-color-exact (globals.css): forces the four semantic
          fills to actually survive print/PDF export -- without it,
          most browsers strip background colours on print by default,
          which would silently drop the clinical signal itself, not
          just look worse. Declared once here since the property
          inherits to every cell/badge underneath. */}
      <div className={`print-color-exact flex flex-col gap-3 ${isPrint ? "print:gap-2" : ""}`}>
        {AFLS_DOMAINS.map((domain) => (
          <AflsDomainCard
            key={domain.code}
            domainCode={domain.code}
            domainName={domain.name}
            items={itemsByDomain[domain.code] ?? []}
            scores={assessment.scores}
            isPrint={isPrint}
            onCellTap={(item) => setSelectedCell({ item, score: assessment.scores[item.id] })}
          />
        ))}
      </div>

      {!isPrint && (
        <BottomSheet isOpen={!!selectedCell} onClose={() => setSelectedCell(null)}>
          {selectedCell && (
            <div className="flex flex-col gap-2">
              <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
                {selectedCell.item.id}
              </p>
              <p className="text-base text-brand-neutral-black">{selectedCell.item.text}</p>
              <p className="text-sm font-semibold text-brand-prussian-blue">
                {selectedCell.score === undefined
                  ? "Not yet scored"
                  : selectedCell.score === "NA"
                    ? "N/A"
                    : `${selectedCell.score}/${selectedCell.item.maxScore}`}
              </p>
            </div>
          )}
        </BottomSheet>
      )}
    </div>
  );
}
