import { PROGRESS_RANGE_OPTIONS, type ProgressRangeKey } from "@/lib/progress/range";

// Filled-pill-on-select segmented control -- mirrors the More page's
// own "Case Review Cadence" selector (src/app/more/page.tsx) exactly,
// the closest existing precedent for a set of day-count options. No
// shared SegmentedControl component exists anywhere in the app (every
// instance is its own inline flex+map), so this follows that same
// established convention rather than introducing a new shared
// primitive.
// allowCustom (Stage C, clinician lens only) adds a 5th "Custom" pill --
// parent/teacher never pass this prop, so the pill simply doesn't exist
// for them rather than existing-but-disabled.
export function RangeSelector({
  value,
  onChange,
  allowCustom = false,
}: {
  value: ProgressRangeKey;
  onChange: (next: ProgressRangeKey) => void;
  allowCustom?: boolean;
}) {
  const options = allowCustom ? [...PROGRESS_RANGE_OPTIONS, { key: "custom" as const, label: "Custom" }] : PROGRESS_RANGE_OPTIONS;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition-colors sm:text-sm ${
            value === option.key
              ? "border-brand-prussian-blue bg-brand-prussian-blue text-white"
              : "border-black/10 bg-white text-brand-neutral-black"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
