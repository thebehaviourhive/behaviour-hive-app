import { DOOR_TYPE_LABELS, type CalmCardDoorType } from "@/lib/calmCards/types";

// Tap 1: calm, minimal, zero clutter -- two large buttons, nothing else
// competing for attention. Copy is the SAME DOOR_TYPE_LABELS the
// clinician authored against in Section 12, so what the parent taps
// here is literally the moment the clinician had in mind when writing
// each card's door.
export function CalmDoorScreen({
  childName,
  onSelectDoor,
}: {
  childName: string;
  onSelectDoor: (door: CalmCardDoorType) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <h1 className="font-heading text-3xl font-bold text-brand-neutral-black">{childName}&apos;s Calm</h1>
      <div className="flex w-full flex-col gap-4">
        {(Object.keys(DOOR_TYPE_LABELS) as CalmCardDoorType[]).map((door) => (
          <button
            key={door}
            type="button"
            onClick={() => onSelectDoor(door)}
            className="w-full rounded-3xl bg-calm-pill py-8 text-2xl font-bold text-calm-ink shadow-sm active:scale-[0.98]"
          >
            {DOOR_TYPE_LABELS[door]}
          </button>
        ))}
      </div>
    </div>
  );
}
