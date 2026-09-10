import type { ReactNode } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";

// Consent/agreement screens rebuild. Cookie-banner shape: one card, a
// heading, a short paragraph, the things you tick, one button -- no
// scrolling at 375px. This is the ONLY shared piece across all five
// role screens, and it is purely presentational: no role prop, no copy,
// no branching. Each of the five screen components (ParentConsentScreen,
// TeacherAgreementScreen, SnaAgreementScreen, PrincipalAgreementScreen,
// ClinicianAgreementScreen) hardcodes its own final copy and composes
// this shell -- "same visual shape, different verbs," never one
// component that takes a role and swaps copy out of a lookup table
// (that was the old screen's own shape, and the thing explicitly not
// to rebuild).
//
// Colour, stricter than the rest of the app: Prussian Blue is the only
// real colour (heading + Continue button). Pastel Blue appears once,
// sparingly, on a checked tick. Everything else is near-monochrome --
// no Golden Brown, no Cream, no red, no emoji, no icon set. "Before you
// start" is identical text on every one of the five screens, so it's
// hardcoded here rather than passed as a prop from five call sites that
// would all pass the same string.
export function ConsentScreenShell({
  children,
  ticks,
  onContinue,
  continueDisabled,
  isSubmitting,
  error,
  footerNote,
}: {
  // The paragraph(s). Rich JSX so a screen can mark its one bold
  // sentence with <strong> -- emphasis by weight, never colour.
  children: ReactNode;
  ticks: ReactNode;
  onContinue: () => void;
  continueDisabled: boolean;
  isSubmitting: boolean;
  error: string | null;
  // Staff/clinician only -- the quiet line under Continue for someone
  // who won't agree. Parent's screen passes nothing.
  footerNote?: ReactNode;
}) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white px-4 py-6">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-center">
          <BrandMark size={40} />
        </div>

        <div className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
          <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Before you start</h1>

          <div className="mt-3 flex flex-col gap-2.5 text-sm leading-relaxed text-brand-neutral-black/80">
            {children}
          </div>

          <div className="mt-5 flex flex-col gap-3">{ticks}</div>

          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button type="button" onClick={onContinue} disabled={continueDisabled || isSubmitting} className="mt-5">
            {isSubmitting ? "Saving…" : "Continue"}
          </Button>

          {footerNote && <p className="mt-3 text-center text-xs leading-relaxed text-brand-neutral-black/50">{footerNote}</p>}
        </div>
      </div>
    </main>
  );
}

// The tick primitive these screens use -- deliberately local to this
// module, not the app-wide Checkbox (src/components/ui/Checkbox.tsx),
// which fills Prussian Blue when checked. These screens' own colour
// rule reserves Prussian Blue for the heading and Continue button only;
// a checked tick here is Pastel Blue, the one other real colour these
// screens use, and only here.
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
      <span className="relative mt-0.5 flex-shrink-0">
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
          className={`flex h-5 w-5 items-center justify-center rounded-md border-2 transition-colors ${
            checked ? "border-brand-pastel-blue bg-brand-pastel-blue" : "border-black/20 bg-white"
          }`}
        >
          {checked && (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-brand-prussian-blue" fill="none">
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
      <span className="text-sm leading-snug text-brand-neutral-black">{children}</span>
    </label>
  );
}
