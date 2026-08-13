import type { RegionOption } from "@/hooks/useRegions";

// Same pill-toggle visual as PillMultiSelect, but that component uses
// `value` as both the toggle key AND the displayed label -- fine for
// diagnoses (the string itself is what's stored), wrong here (the
// stored value is a region UUID, the display needs to be its name).
// A small dedicated variant rather than widening PillMultiSelect's own
// contract for every other caller.
export function RegionMultiSelect({
  regions,
  selected,
  onToggle,
}: {
  regions: RegionOption[];
  selected: string[];
  onToggle: (regionId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {regions.map((region) => {
        const isSelected = selected.includes(region.id);
        return (
          <button
            key={region.id}
            type="button"
            onClick={() => onToggle(region.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              isSelected
                ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
            }`}
          >
            {region.name}
          </button>
        );
      })}
    </div>
  );
}
