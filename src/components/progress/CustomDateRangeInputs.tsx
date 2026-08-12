import type { DateRange } from "@/lib/progress/range";

// STAGE C, CLINICIAN LENS ONLY. Mirrors DirectAssessmentSection's ABC
// assessment-window picker exactly (same two native <input type="date">
// fields, same classes, same "no start<=end enforcement" posture) --
// the closest existing precedent in the app for a custom date range, so
// this reuses its pattern rather than inventing a new one.
export function CustomDateRangeInputs({
  value,
  onChange,
}: {
  value: DateRange | null;
  onChange: (next: DateRange) => void;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex-1">
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">From</label>
        <input
          type="date"
          value={value?.start ?? ""}
          onChange={(e) => onChange({ start: e.target.value, end: value?.end ?? e.target.value })}
          className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
      </div>
      <div className="flex-1">
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">To</label>
        <input
          type="date"
          value={value?.end ?? ""}
          onChange={(e) => onChange({ start: value?.start ?? e.target.value, end: e.target.value })}
          className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
      </div>
    </div>
  );
}
