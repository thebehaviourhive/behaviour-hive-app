import type { FlagTrendEntry } from "@/lib/progress/flags";

// Chip styling matches FlagChips in parent-dashboard/page.tsx (rounded-full
// bg-slate-100 text-slate-600) for the base chip, with a small direction
// indicator added -- no red anywhere (constraint: red never appears in
// the parent lens outside the regulation-state colour), so "rising" gets
// a neutral up-arrow in ink, not an alert colour.
const DIRECTION_LABEL: Record<FlagTrendEntry["direction"], string> = {
  rising: "↑",
  fading: "↓",
  new: "new",
  steady: "",
};

export function FlagTrendList({ trends }: { trends: FlagTrendEntry[] }) {
  if (trends.length === 0) {
    return <p className="text-sm text-brand-neutral-black/50">No flags logged in this period.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {trends.map((t) => (
        <li
          key={t.flag}
          className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
        >
          <span>{t.flag}</span>
          <span className="text-slate-400">
            {t.current}
            {DIRECTION_LABEL[t.direction] && ` ${DIRECTION_LABEL[t.direction]}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
