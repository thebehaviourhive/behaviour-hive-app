import type { ReactNode } from "react";

// Consent/agreement screens rebuild, round 2 (design correction --
// "the current version reads as a wireframe"). No card: content sits
// directly on a pure white page. Structure is carried by a small type
// scale (eyebrow / lede / body) and two hairline rules, not by a
// container or by colour. This is still the ONLY shared piece across
// all five role screens, and still purely presentational: no role
// prop, no copy, no branching -- each screen component hardcodes its
// own final copy and composes this shell.
//
// Colour, amended: Prussian Blue is the baseline (eyebrow, checked
// tick, enabled button -- unchanged from round 1). Pastel Blue and
// Golden Brown are back in play, each doing exactly one structural
// job and nowhere else: Pastel Blue on the two hairline rules, Golden
// Brown on a screen's own emphasised sentence (set by the screen
// itself, via the <Emphasis> export below -- never by this shell).
// Cream and red stay out entirely (an error message is the one
// exception, matching this app's own established error-state
// convention everywhere else -- a functional signal, not content).
//
// Exact values throughout, not the nearest Tailwind step -- 17px lede,
// not text-lg; #1A1A1A, not black/80; 1.5px tick border, not border-2
// -- confirmed against the brief's own explicit pixel/hex values.
export function ConsentScreenShell({
  lede,
  body,
  ticks,
  onContinue,
  continueDisabled,
  isSubmitting,
  error,
  footerNote,
  onOpenPrivacy,
}: {
  // The first paragraph -- what someone actually reads. Larger, full
  // contrast.
  lede: ReactNode;
  // Every paragraph after the lede. Smaller, muted -- context, not the
  // headline fact.
  body: ReactNode[];
  ticks: ReactNode;
  onContinue: () => void;
  continueDisabled: boolean;
  isSubmitting: boolean;
  error: string | null;
  // Staff/clinician only -- the quiet line under Continue for someone
  // who won't agree. Parent's screen passes nothing.
  footerNote?: ReactNode;
  // Every screen gets this -- a consent screen with no route to the
  // full policy is a real gap, not a layout nicety (dropped from round
  // 1 only because the layout was given literally; corrected here).
  onOpenPrivacy: () => void;
}) {
  return (
    <main className="flex min-h-full flex-1 justify-center bg-white px-6 py-5 font-consent">
      <div className="w-full max-w-[520px]">
        <p className="text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-[#A3A3A3]">
          Behaviour Passport
        </p>

        {/* 32px to this section -- eyebrow, rule, lede/body. */}
        <div className="mt-8">
          <h1 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-prussian-blue">
            Before you start
          </h1>

          <div className="mt-2 h-px bg-brand-pastel-blue" />

          <div className="mt-4 flex flex-col gap-4">
            <p className="text-[17px] leading-[1.5] text-[#1A1A1A]">{lede}</p>
            {body.map((paragraph, i) => (
              <p key={i} className="text-[14px] leading-[1.6] text-[#5A5A5A]">
                {paragraph}
              </p>
            ))}
          </div>
        </div>

        {/* 32px to the tick block, hairline rule right above it. */}
        <div className="mt-8">
          <div className="h-px bg-brand-pastel-blue" />
          <div className="mt-4 flex flex-col gap-4">{ticks}</div>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-[13px] font-medium text-red-600">
            {error}
          </p>
        )}

        {/* 24px above the button -- its own rhythm, distinct from the
            32px section gap either side of it. */}
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onContinue}
            disabled={continueDisabled || isSubmitting}
            className={`inline-flex items-center justify-center rounded-full px-8 py-3 text-[15px] font-medium transition-colors disabled:cursor-not-allowed ${
              continueDisabled || isSubmitting
                ? "border border-[#D4D4D4] bg-white text-[#A3A3A3]"
                : "border border-brand-prussian-blue bg-brand-prussian-blue text-white"
            }`}
          >
            {isSubmitting ? "Saving…" : "Continue"}
          </button>
        </div>

        {footerNote && (
          <p className="mt-3 text-center text-[12px] leading-relaxed text-[#A3A3A3]">{footerNote}</p>
        )}

        <p className="mt-2 text-center text-[12px] leading-relaxed text-[#A3A3A3]">
          <button type="button" onClick={onOpenPrivacy} className="font-medium text-brand-prussian-blue">
            Read our privacy policy
          </button>
        </p>
      </div>
    </main>
  );
}

// A screen's own emphasised sentence -- weight AND colour, per the
// amendment. Exported from here (not redefined per screen) so every
// screen's one bold sentence uses the exact same token, never a
// near-miss hex typed out five times.
export function ConsentEmphasis({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-[#D78825]">{children}</strong>;
}

// The tick primitive these screens use -- deliberately local to this
// module, not the app-wide Checkbox (src/components/ui/Checkbox.tsx),
// which is a different size/shape/checked-fill built for the rest of
// the app's own rounded language. 18px square, 1.5px border, 2px
// radius, checked = solid Prussian Blue with a white mark. Aligned to
// the FIRST LINE of the label (a 2px top offset), not the vertical
// middle of a possibly-multi-line block. The whole row is the hit
// target, not just the box.
export function ConsentTick({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer select-none items-start gap-3">
      <span className="relative mt-[2px] flex-shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          required
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden
          className={`flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border-[1.5px] transition-colors ${
            checked ? "border-brand-prussian-blue bg-brand-prussian-blue" : "border-[#A3A3A3] bg-white"
          }`}
        >
          {checked && (
            <svg viewBox="0 0 16 16" className="h-3 w-3 text-white" fill="none">
              <path
                d="M3 8.5L6.5 12L13 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </span>
      <span className="text-[14px] leading-[1.5] text-[#1A1A1A]">{children}</span>
    </label>
  );
}
