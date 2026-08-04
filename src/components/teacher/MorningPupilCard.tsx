import type { MorningPupilStatus } from "@/hooks/useTeacherMorningCheckins";

const BORDER_CLASS: Record<MorningPupilStatus["rag"], string> = {
  green: "border-t-green-500",
  amber: "border-t-brand-golden-brown",
  red: "border-t-red-600",
  grey: "border-t-gray-300",
};

const STATE_LABEL: Record<MorningPupilStatus["rag"], string> = {
  green: "Settled",
  amber: "Anxious",
  red: "Dysregulated",
  grey: "Awaiting",
};

export function MorningPupilCard({
  pupil,
  onTap,
}: {
  pupil: MorningPupilStatus;
  onTap: () => void;
}) {
  const isTappable = pupil.rag === "red" || pupil.rag === "amber";

  return (
    <button
      type="button"
      disabled={!isTappable}
      onClick={onTap}
      className={`flex flex-col items-center justify-center rounded-xl border-t-4 bg-white p-3 text-center shadow-sm transition-colors ${
        BORDER_CLASS[pupil.rag]
      } ${isTappable ? "active:bg-black/[0.02]" : "cursor-default"}`}
    >
      <p className="font-heading text-lg font-bold text-brand-prussian-blue">{pupil.displayName}</p>
      <p className="font-sans text-xs text-brand-neutral-black/70">{STATE_LABEL[pupil.rag]}</p>
    </button>
  );
}

export function MorningPupilCardSkeleton() {
  return (
    <div className="flex animate-pulse flex-col items-center justify-center gap-1.5 rounded-xl border-t-4 border-t-gray-200 bg-white p-3">
      <span className="h-4 w-16 rounded bg-black/10" />
      <span className="h-3 w-12 rounded bg-black/5" />
    </div>
  );
}
