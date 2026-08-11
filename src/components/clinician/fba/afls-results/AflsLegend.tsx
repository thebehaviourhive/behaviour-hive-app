import { AFLS_BADGE_ORDER, AFLS_BADGES } from "@/lib/fba/aflsResults";
import { ScoreBadge } from "./ScoreBadge";

// Horizontal, wrap-enabled legend of all five score states -- appears
// with every AFLS results display (digital and print), per the brief.
export function AflsLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2" role="list" aria-label="AFLS score legend">
      {AFLS_BADGE_ORDER.map((value) => (
        <span key={value} role="listitem" className="inline-flex items-center gap-1.5">
          <ScoreBadge value={value} />
          <span className="text-xs font-medium text-brand-neutral-black/70 print:text-black">
            {AFLS_BADGES[value].label}
          </span>
        </span>
      ))}
    </div>
  );
}
