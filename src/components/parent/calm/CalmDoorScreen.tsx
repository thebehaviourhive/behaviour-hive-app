import { DOOR_TYPE_LABELS, type CalmCardDoorType } from "@/lib/calmCards/types";

// Tap 1: calm, minimal, zero clutter -- the heading and the two doors
// are the entire screen, nothing else. Copy is the SAME DOOR_TYPE_LABELS
// the clinician authored against in Section 12, so what the parent taps
// here is literally the moment the clinician had in mind when writing
// each card's door.
//
// Door order and visual weight are DELIBERATELY asymmetric, hardcoded
// here only -- "It's happening now" (deescalation) renders first as the
// dominant, filled hot door; "Something's building" (prevention)
// renders second as the calmer, outlined cool door. This is purely a
// display-order/styling choice local to this screen: DOOR_TYPE_LABELS'
// own key order (prevention, then deescalation) is untouched, since
// that same object also drives the clinician's door-type selector in
// Section 12 (CalmCardSection.tsx) and must not be affected by this.
//
// Colour pairings (both reused from the existing calm-pill/calm-ink
// tokens, no new hexes introduced):
// - Hot door (filled): bg-calm-ink (#C95F55) with white text -- the
//   deeper, filled pairing the brief itself offers, chosen over the
//   pill/ink combo specifically because a filled block reads as more
//   urgent than an outline at a glance, which is the whole point here.
// - Cool door (outlined): border + text in Prussian Blue on a
//   Pastel-Blue-bordered outline -- the border is the literal
//   "Pastel Blue family" the brief asks for; the text deliberately
//   uses Prussian Blue rather than literal pastel-blue-on-white, which
//   fails legible contrast for a tap target in a crisis-support screen.
//   This mirrors the exact pastel-blue-border / prussian-blue-content
//   pairing this app's own bottom nav already uses for its active-pill
//   state (AppBottomNav.tsx), not a new combination invented for this.
export function CalmDoorScreen({
  childName,
  onSelectDoor,
}: {
  childName: string;
  onSelectDoor: (door: CalmCardDoorType) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 px-6 text-center">
      <h1 className="font-heading text-3xl font-bold text-brand-prussian-blue">{childName}&apos;s Calm Cards</h1>
      <div className="flex w-full flex-col gap-5">
        <button
          type="button"
          onClick={() => onSelectDoor("deescalation")}
          className="w-full rounded-3xl bg-calm-ink py-10 text-3xl font-extrabold text-white shadow-md active:scale-[0.98]"
        >
          {DOOR_TYPE_LABELS.deescalation}
        </button>
        <button
          type="button"
          onClick={() => onSelectDoor("prevention")}
          className="w-full rounded-3xl border-2 border-brand-pastel-blue bg-transparent py-5 text-lg font-semibold text-brand-prussian-blue active:scale-[0.98]"
        >
          {DOOR_TYPE_LABELS.prevention}
        </button>
      </div>
    </div>
  );
}
