import { BottomSheet } from "@/components/ui/BottomSheet";

const OUTPUT_ITEMS = ["Identifies triggers", "Creates custom strategies", "Syncs directly to your child's passport"];

// States A/B's info sheet. All copy here is a first pass, deliberately
// easy to swap -- every string below is a plain literal, nothing
// computed, so wording can be refined without touching layout.
export function WhatIsAnFbaSheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="-m-6 rounded-t-3xl bg-brand-safe-ivory p-6">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-black/10" />

        <div
          aria-hidden
          className="mb-5 flex h-28 w-full items-center justify-center rounded-2xl bg-brand-pastel-blue/30 text-4xl"
        >
          🔍
        </div>

        <h2 className="font-heading text-xl font-bold text-brand-prussian-blue">
          Functional Behaviour Assessment
        </h2>

        <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <p className="mb-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
            What is it?
          </p>
          <p className="text-sm leading-relaxed text-brand-neutral-black">
            Behaviour is communication. An FBA is a structured process a behavioural clinician uses to
            find the root cause behind a behaviour -- not just what it looks like, but why it&apos;s
            happening.
          </p>
        </div>

        <div className="mt-4">
          <p className="mb-2 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/60">
            The Output
          </p>
          <ul className="flex flex-col gap-2">
            {OUTPUT_ITEMS.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-brand-neutral-black">
                <span
                  aria-hidden
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-prussian-blue text-xs font-bold text-white"
                >
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <p className="mb-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/60">
            How to get one
          </p>
          <p className="text-sm leading-relaxed text-brand-neutral-black">
            Connect a behavioural psychologist to your child&apos;s passport using their Clinician Code
            -- from there, they can start an assessment whenever the two of you are ready.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white"
        >
          Got it
        </button>
      </div>
    </BottomSheet>
  );
}
