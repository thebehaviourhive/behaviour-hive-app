"use client";

import { useState } from "react";

const NOT_SURE = "__not_sure__";

// Optional Tap 2: the child's OWN tags for this door, plus "Not sure".
// Selecting narrows (via orderCardsForDeck, not a hard filter); "Not
// sure" or just proceeding serves the door's full set -- so this screen
// never blocks progress, it only ever adds precision.
export function CalmChipScreen({
  availableTags,
  onProceed,
}: {
  availableTags: string[];
  onProceed: (selectedTags: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(tag: string) {
    if (tag === NOT_SURE) {
      setSelected([]);
      return;
    }
    setSelected((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="font-heading text-2xl font-bold text-brand-neutral-black">What&apos;s going on?</h1>
        <p className="mt-2 text-sm text-brand-neutral-black/60">Optional — this just helps find the right card first.</p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {availableTags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
              selected.includes(tag)
                ? "border border-calm-ink bg-calm-pill text-calm-ink"
                : "border border-black/10 bg-white text-brand-neutral-black"
            }`}
          >
            {tag}
          </button>
        ))}
        <button
          type="button"
          onClick={() => toggle(NOT_SURE)}
          className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
            selected.length === 0
              ? "border border-calm-ink bg-calm-pill text-calm-ink"
              : "border border-black/10 bg-white text-brand-neutral-black"
          }`}
        >
          Not sure
        </button>
      </div>

      <button
        type="button"
        onClick={() => onProceed(selected)}
        className="w-full rounded-2xl bg-calm-ink py-3.5 text-base font-semibold text-white"
      >
        Show me
      </button>
    </div>
  );
}
