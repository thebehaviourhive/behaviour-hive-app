// Persistent footer on every Calm Card (constraint 3A) -- a plain tap
// target, rendered as a sibling of the carousel's swipeable touch area
// (CalmCardCarousel's `footer` slot sits OUTSIDE touchAreaRef entirely),
// so there is structurally no gesture that could ever fire this: no
// swipe handler is attached to this element or any ancestor of it that
// also owns the card-advance logic. Escalation is reachable only by a
// deliberate tap here.
export function CalmSafetyFooter({ onTap }: { onTap: () => void }) {
  return (
    <div className="pt-3 text-center">
      <button type="button" onClick={onTap} className="text-sm font-medium text-brand-neutral-black/40 underline underline-offset-2">
        None of this helping?
      </button>
    </div>
  );
}
