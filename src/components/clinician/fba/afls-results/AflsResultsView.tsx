"use client";

import { useAflsItemBank } from "@/hooks/useAflsItemBank";
import { AFLS_DOMAINS } from "@/lib/fba/types";
import { isAflsResultsEmpty, tallyDomain } from "@/lib/fba/aflsResults";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { FbaNote } from "../FbaNote";
import { AflsLegend } from "./AflsLegend";
import { AflsStackedBar } from "./AflsStackedBar";
import { AflsHoneycomb } from "./AflsHoneycomb";
import { AflsAccordionBreakdown } from "./AflsAccordionBreakdown";
import { AflsPrintBreakdown } from "./AflsPrintBreakdown";
import type { AflsItemScore } from "@/lib/fba/types";

// Section 11 results display -- READ-ONLY presentation only, used
// wherever AFLS is being shown rather than scored: the clinician's own
// locked/completed view, the parent reader, and the print/PDF page. The
// input/scoring tool (AflsSection.tsx) is untouched and still owns
// active editing.
//
// LAYER 1 (the honeycomb vs. stacked-bar split): the brief's own 375px
// gate. A true single tessellated hive with 8 individually-labelled
// clusters, ≥40px tap targets, and legible item-level popovers cannot
// honestly hold up in ~340px of usable width -- either the hexes shrink
// below a comfortable tap/legibility floor to stay a "single glance," or
// staying legible-sized stretches the figure into a very tall single
// column that no longer reads as one glance-able figure. Print has no
// such constraint (A4, and the honeycomb is the print figure), so:
//   - digital (clinician + parent, mobile-first): stacked-bar
//   - print: the honeycomb
export function AflsResultsView({
  scoresData,
  summary,
  variant,
}: {
  scoresData: Record<string, AflsItemScore[]>;
  summary: string | null;
  variant: "digital" | "print";
}) {
  const { itemsByDomain, loadError } = useAflsItemBank();

  if (loadError) {
    return <InlineErrorState message="Couldn't load the AFLS item bank." onRetry={() => window.location.reload()} />;
  }

  // Existing empty state, untouched -- no scores anywhere and no
  // narrative, so there's nothing worth an elaborate visual for.
  if (isAflsResultsEmpty(scoresData, summary)) {
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

  const tallies = AFLS_DOMAINS.map((domain) => tallyDomain(domain, itemsByDomain[domain] ?? [], scoresData[domain] ?? []));

  return (
    <div className="flex flex-col gap-6">
      {summary?.trim() && (
        <div className="rounded-r-xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4">
          <p className="whitespace-pre-wrap text-sm text-brand-neutral-black">{summary}</p>
        </div>
      )}

      <AflsLegend />

      {variant === "print" ? (
        <AflsHoneycomb itemsByDomain={itemsByDomain} scoresData={scoresData} className="print-avoid-break" />
      ) : (
        <AflsStackedBar tallies={tallies} />
      )}

      {variant === "print" ? (
        <AflsPrintBreakdown tallies={tallies} itemsByDomain={itemsByDomain} scoresData={scoresData} />
      ) : (
        <AflsAccordionBreakdown tallies={tallies} itemsByDomain={itemsByDomain} scoresData={scoresData} />
      )}
    </div>
  );
}
