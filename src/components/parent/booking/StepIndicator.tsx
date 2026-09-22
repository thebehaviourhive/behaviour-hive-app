// Booking-flow redesign, section 4/5 -- "a light step indicator - four
// steps, where they are. Not a wizard with heavy chrome; a quiet line
// of text or dots." "Booked" (step 5) is the flow's own endpoint, not
// a decision the parent makes, so it's never counted here -- the
// indicator only ever spans the real choice points (up to Who/What/
// When/Confirm), and fewer still whenever Who or What is skipped
// (single clinician, single session type -- design brief: "Most
// parents will never see this screen").
//
// Dot-position pattern lifted from CalmCardCarousel.tsx's own "quiet
// progress" shape (active = wider pill, inactive = small dimmed dot),
// reused rather than reinvented, in this flow's own brand colours.

export function StepIndicator({ current, total }: { current: number; total: number }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center gap-2 px-4 pb-2" role="tablist" aria-label="Booking step">
      <span className="font-sans text-eyebrow text-brand-neutral-black/40">
        Step {current} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            aria-hidden
            className={`h-1.5 rounded-full transition-all ${
              n === current ? "w-4 bg-brand-prussian-blue" : "w-1.5 bg-brand-prussian-blue/20"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
