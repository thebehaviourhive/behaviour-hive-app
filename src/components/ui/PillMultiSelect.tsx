interface PillOption {
  value: string;
  fullName?: string | null;
}

interface PillMultiSelectProps {
  options: PillOption[];
  selected: string[];
  onToggle: (value: string) => void;
}

export function PillMultiSelect({ options, selected, onToggle }: PillMultiSelectProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            title={option.fullName ?? option.value}
            onClick={() => onToggle(option.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              isSelected
                ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
            }`}
          >
            {option.value}
          </button>
        );
      })}
    </div>
  );
}
