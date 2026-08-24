interface PillSingleSelectOption<T extends string> {
  value: T;
  label: string;
}

interface PillSingleSelectProps<T extends string> {
  options: readonly PillSingleSelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
}

// Single-select sibling to PillMultiSelect -- same pill-toggle visual,
// exclusive choice instead of a set. For the Incident Log's own enum
// fields (category, party, staff_count_needed, distress_level, and
// later restrictive_practices' planning_status/hold_type/position/level)
// -- no dedicated radio-group component existed before this module.
export function PillSingleSelect<T extends string>({ options, value, onChange }: PillSingleSelectProps<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              isSelected
                ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
