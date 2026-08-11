import { AFLS_BADGES, AFLS_SCORED_ORDER, type DomainTally } from "@/lib/fba/aflsResults";

// LAYER 1, digital fallback (see AflsResultsView for why this ships
// instead of the honeycomb on screen -- the 375px legibility gate).
// One row per domain: a single 100%-width bar, segments proportional to
// scored counts in encoding order, unscored as a dashed remainder on
// the right. Spec: h-6 rounded, count+icon labels only in segments
// wide enough to hold them (~15%+).
function DomainBarRow({ tally }: { tally: DomainTally }) {
  const scoredCount = tally.total - tally.counts.unscored;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="font-heading text-sm font-bold text-brand-prussian-blue">{tally.domain}</p>
        <p className="flex-shrink-0 text-xs text-brand-neutral-black/50">
          {scoredCount}/{tally.total} scored
        </p>
      </div>

      <div className="flex h-6 w-full overflow-hidden rounded-full border border-black/5 bg-white">
        {AFLS_SCORED_ORDER.map((value) => {
          const count = tally.counts[value];
          if (count === 0) return null;
          const pct = (count / tally.total) * 100;
          const cfg = AFLS_BADGES[value];
          return (
            <div
              key={value}
              title={`${cfg.label}: ${count}`}
              style={{ width: `${pct}%` }}
              className={`flex items-center justify-center ${cfg.bgClass} ${cfg.textClass}`}
            >
              {pct >= 15 && (
                <span className="text-[11px] font-bold">
                  {cfg.icon} {count}
                </span>
              )}
            </div>
          );
        })}
        {tally.counts.unscored > 0 &&
          (() => {
            const pct = (tally.counts.unscored / tally.total) * 100;
            return (
              <div
                title={`Unscored: ${tally.counts.unscored}`}
                style={{ width: `${pct}%` }}
                className="flex items-center justify-center border-2 border-dashed border-brand-neutral-black/15 bg-transparent"
              >
                {pct >= 15 && (
                  <span className="text-[11px] font-bold text-brand-neutral-black/40">
                    ? {tally.counts.unscored}
                  </span>
                )}
              </div>
            );
          })()}
      </div>

      {tally.isFullyUnscored && (
        <p className="mt-1 text-xs italic text-brand-neutral-black/40">Unscored</p>
      )}
    </div>
  );
}

export function AflsStackedBar({ tallies }: { tallies: DomainTally[] }) {
  return (
    <div className="flex flex-col gap-4">
      {tallies.map((tally) => (
        <DomainBarRow key={tally.domain} tally={tally} />
      ))}
    </div>
  );
}
