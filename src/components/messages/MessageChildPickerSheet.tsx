"use client";

import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";

// The compose picker at scale. Shared by every role that picks a child
// before composing (teacher/principal/clinician -- confirmed by reading
// all three, identical unbounded `passports.map()` pattern, none
// sorted). One component, three call sites, per instruction.
//
// SORT: always alphabetical, unconditionally, inside this component --
// not left to the caller to remember. None of the three source queries
// (get_my_accessible_children, and principal/clinician's own list
// loads) had an ORDER BY at all -- Postgres without one returns
// whatever the query plan produces, unstable between calls. That's a
// bug on its own, separate from the length problem it was mistaken for
// -- fixed here at the one place every caller renders through, not
// patched three times upstream. Recency ordering is a real follow-up
// (cheapest signal: most recent message per child), deliberately not
// this pass -- alphabetical-now is strictly better than the unordered
// state it replaces regardless of what comes later.
//
// SCALE: short list stays exactly as fast as it's always been -- under
// the threshold, every candidate renders, no search box, no extra tap.
// At 7+, a search box appears (reusing the Directory's own plain
// type-to-filter shape, ChildrenList.tsx -- not a second implementation)
// and the list itself collapses to the first 6 with a "Show all" line,
// until either search narrows it or "Show all" is tapped. Typing always
// searches the FULL set regardless of collapse state.
const COLLAPSE_THRESHOLD = 7;
const COLLAPSED_VISIBLE_COUNT = 6;

export interface MessagePickerCandidate {
  passportId: string;
  displayName: string;
}

export function MessageChildPickerSheet({
  isOpen,
  onClose,
  title,
  candidates,
  onSelect,
  emptyMessage = "No one to choose from yet.",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  candidates: MessagePickerCandidate[];
  onSelect: (passportId: string) => void;
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    // Reset on open, not on every candidates re-render -- matches
    // ComposeMessageSheet's own reset convention, so a parent refetch
    // while this sheet is already open never clobbers an in-progress
    // search.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
    setShowAll(false);
  }, [isOpen]);

  const sorted = [...candidates].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const needsSearch = sorted.length >= COLLAPSE_THRESHOLD;
  const trimmedQuery = query.trim().toLowerCase();
  const filtered = trimmedQuery
    ? sorted.filter((c) => c.displayName.toLowerCase().includes(trimmedQuery))
    : sorted;
  const isCollapsed = needsSearch && !trimmedQuery && !showAll;
  const visible = isCollapsed ? filtered.slice(0, COLLAPSED_VISIBLE_COUNT) : filtered;
  const hiddenCount = filtered.length - visible.length;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">{title}</h2>

      {needsSearch && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          className="mt-4 w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm text-brand-neutral-black placeholder:text-black/40 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
      )}

      {sorted.length === 0 ? (
        <p className="mt-4 py-4 text-center text-sm text-brand-neutral-black/50">{emptyMessage}</p>
      ) : filtered.length === 0 ? (
        <p className="mt-4 py-4 text-center text-sm text-brand-neutral-black/50">No one matches &quot;{query.trim()}&quot;.</p>
      ) : (
        <div className="mt-4 flex max-h-96 flex-col gap-2 overflow-y-auto">
          {visible.map((candidate) => (
            <button
              key={candidate.passportId}
              type="button"
              onClick={() => onSelect(candidate.passportId)}
              className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-left shadow-sm"
            >
              <span className="text-sm font-semibold text-brand-neutral-black">{candidate.displayName}</span>
              <span className="text-lg text-brand-neutral-black/30">›</span>
            </button>
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="rounded-2xl border border-dashed border-black/10 bg-white/60 py-3 text-center text-sm font-semibold text-brand-prussian-blue"
            >
              Show all ({hiddenCount} more)
            </button>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
