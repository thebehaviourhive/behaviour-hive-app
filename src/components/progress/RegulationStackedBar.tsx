import {
  REGULATION_STATE_COLOR,
  REGULATION_STATE_LABEL,
  REGULATION_STATE_ORDER,
  type StateDistribution,
} from "@/lib/progress/regulation";

// Chart 2. Same single-full-width-bar, proportional-segments technique
// as AflsStackedBar.tsx (src/components/clinician/fba/afls-results/) --
// segments in state order, "no check-in" as a dashed remainder on the
// right, count labels only shown in segments wide enough to hold them.
export function RegulationStackedBar({ distribution }: { distribution: StateDistribution }) {
  const { totalDays, noData } = distribution;
  if (totalDays === 0) return null;

  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-full border border-black/5 bg-white">
        {REGULATION_STATE_ORDER.map((state) => {
          const count = distribution[state];
          if (count === 0) return null;
          const pct = (count / totalDays) * 100;
          const colors = REGULATION_STATE_COLOR[state];
          return (
            <div
              key={state}
              title={`${REGULATION_STATE_LABEL[state]}: ${count}`}
              style={{ width: `${pct}%` }}
              className={`flex items-center justify-center ${colors.dot}`}
            >
              {pct >= 15 && <span className="text-[11px] font-bold text-white">{count}</span>}
            </div>
          );
        })}
        {noData > 0 &&
          (() => {
            const pct = (noData / totalDays) * 100;
            return (
              <div
                title={`No check-in: ${noData}`}
                style={{ width: `${pct}%` }}
                className="flex items-center justify-center border-2 border-dashed border-brand-neutral-black/15 bg-transparent"
              >
                {pct >= 15 && <span className="text-[11px] font-bold text-brand-neutral-black/40">{noData}</span>}
              </div>
            );
          })()}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {REGULATION_STATE_ORDER.map((state) => (
          <div key={state} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-brand-neutral-black/70">
              <span aria-hidden className={`h-2 w-2 rounded-full ${REGULATION_STATE_COLOR[state].dot}`} />
              {REGULATION_STATE_LABEL[state]}
            </span>
            <span className="text-xs font-semibold text-brand-neutral-black">{distribution[state]}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-brand-neutral-black/70">
            <span aria-hidden className="h-2 w-2 rounded-full border border-dashed border-black/20" />
            No check-in
          </span>
          <span className="text-xs font-semibold text-brand-neutral-black">{noData}</span>
        </div>
      </div>
    </div>
  );
}
