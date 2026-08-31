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
  // PRD 3, Stage 5 -- two accounts is itself always worth a tap, even
  // when both happen to agree (a settled RAG tier from two guardians
  // who both reported calm) -- the tile below can't show two names, so
  // "there's a second one" only ever surfaces once tapped.
  const hasMultiple = pupil.checkins.length > 1;
  const isTappable = pupil.rag === "red" || pupil.rag === "amber" || hasMultiple;

  return (
    <button
      type="button"
      disabled={!isTappable}
      onClick={onTap}
      className={`relative flex flex-col items-center justify-center rounded-xl border-t-4 bg-white p-3 text-center shadow-sm transition-colors ${
        BORDER_CLASS[pupil.rag]
      } ${isTappable ? "active:bg-black/[0.02]" : "cursor-default"}`}
    >
      {hasMultiple && (
        // PRD 3, Stage 5 -- "the grid tile must show there are two."
        // Plain count, no names here (the tile's too small to say who
        // without crowding it) -- the detail sheet is where each
        // account gets attributed.
        <span
          aria-hidden
          className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-prussian-blue px-1 text-[10px] font-bold text-white"
        >
          {pupil.checkins.length}
        </span>
      )}
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
