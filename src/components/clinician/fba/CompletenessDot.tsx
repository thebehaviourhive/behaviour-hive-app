import type { SectionCompleteness } from "@/lib/fba/sections";

// Grey (nothing entered yet) / amber (started) / green (done) -- matches
// the golden-brown "warning" accent already used for the dashboard's
// "Reviews Due" stat card, so amber reads the same way across the app.
const DOT_CLASSES: Record<SectionCompleteness, string> = {
  empty: "bg-black/15",
  partial: "bg-brand-golden-brown",
  complete: "bg-green-500",
};

export function CompletenessDot({ state }: { state: SectionCompleteness }) {
  return (
    <span
      aria-hidden
      className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${DOT_CLASSES[state]}`}
    />
  );
}
