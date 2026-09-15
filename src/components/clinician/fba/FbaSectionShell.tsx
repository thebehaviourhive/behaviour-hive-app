"use client";

import type { ReactNode } from "react";
import type { SaveStatus } from "@/hooks/useFbaReport";
import { SavedStateIndicator } from "./SavedStateIndicator";

// Shared full-screen editor chrome for every FBA section page: sticky
// header (back + title + saved-state), scrollable body. `readOnly` swaps
// the saved-state indicator for a static badge -- used once an FBA is
// completed and the whole report becomes a read-only rendering path.
//
// Clinician desktop pass, Stage 1: `main` gets the same
// lg:max-w-[66.6667%] cap as every other page in this pass (School's
// own precedent). This is the one change point for all fourteen
// sections -- every section page renders its own fields as this
// component's `children`, so capping the width here reaches all of
// them without touching each section's own file. Header stays full
// width (matches School's header-outside-the-cap pattern) so the
// sticky back/title/save-state bar doesn't visually shrink alongside
// the form fields beneath it.
//
// FBA next-section workflow fix: onPrevious/onNext, both optional --
// undefined at section 1 (no previous) and section 14 (no next; that
// section has its own Finalize action instead). This component knows
// nothing about save/flush mechanics or FBA_SECTIONS ordering -- the
// section page computes the target and passes a plain callback, same
// shape as onBack always has. isNavigating disables all three
// (Back/Previous/Next) while a flush-before-navigate is in flight, so a
// second click can't race the first's outcome.
export function FbaSectionShell({
  title,
  sectionNumber,
  onBack,
  saveStatus,
  isDirty,
  hasLoaded,
  saveError,
  onFlushSave,
  onCancelSave,
  readOnly,
  onPrevious,
  onNext,
  isNavigating = false,
  children,
}: {
  title: string;
  sectionNumber: number;
  onBack: () => void;
  saveStatus: SaveStatus;
  isDirty: boolean;
  hasLoaded: boolean;
  saveError: string | null;
  onFlushSave: () => void;
  onCancelSave: () => void;
  readOnly: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  isNavigating?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-black/5 bg-brand-off-white/95 px-4 pt-6 pb-4 backdrop-blur-sm">
        <button
          type="button"
          onClick={onBack}
          disabled={isNavigating}
          aria-label="Back to section list"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue disabled:opacity-40"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
            Section {sectionNumber}
          </p>
          <h1 className="truncate font-heading text-lg font-bold text-brand-prussian-blue">{title}</h1>
        </div>
        <div className="flex-shrink-0">
          {readOnly ? (
            <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-brand-neutral-black/50">
              Read-only
            </span>
          ) : (
            <SavedStateIndicator
              status={saveStatus}
              isDirty={isDirty}
              hasLoaded={hasLoaded}
              error={saveError}
              onFlush={onFlushSave}
              onCancel={onCancelSave}
            />
          )}
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-10 lg:max-w-[66.6667%]">{children}</main>

      {(onPrevious || onNext) && (
        <div className="flex items-center justify-between gap-3 border-t border-black/5 px-4 py-4 lg:max-w-[66.6667%]">
          {onPrevious ? (
            <button
              type="button"
              onClick={onPrevious}
              disabled={isNavigating}
              className="rounded-2xl border border-black/10 px-5 py-2.5 text-sm font-semibold text-brand-neutral-black/70 transition-colors disabled:opacity-40"
            >
              ‹ Previous
            </button>
          ) : (
            <span />
          )}
          {onNext ? (
            <button
              type="button"
              onClick={onNext}
              disabled={isNavigating}
              className="rounded-2xl bg-brand-prussian-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-40"
            >
              Next ›
            </button>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
