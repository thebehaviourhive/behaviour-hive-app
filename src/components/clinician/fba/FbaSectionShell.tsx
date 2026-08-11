"use client";

import type { ReactNode } from "react";
import type { SaveStatus } from "@/hooks/useFbaReport";
import { SavedStateIndicator } from "./SavedStateIndicator";

// Shared full-screen editor chrome for every FBA section page: sticky
// header (back + title + saved-state), scrollable body. `readOnly` swaps
// the saved-state indicator for a static badge -- used once an FBA is
// completed and the whole report becomes a read-only rendering path.
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
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-black/5 bg-brand-off-white/95 px-4 pt-6 pb-4 backdrop-blur-sm">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to section list"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
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

      <main className="flex-1 px-4 pt-4 pb-10">{children}</main>
    </div>
  );
}
