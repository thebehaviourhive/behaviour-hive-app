"use client";

import { useState } from "react";
import Link from "next/link";
import { LifeBuoy, Lock } from "lucide-react";
import { useParentCalmAccess } from "@/hooks/useParentCalmAccess";
import { CalmUnlockSheet } from "./CalmUnlockSheet";

// The 4th nav item (constraint 2A). Deliberately NOT a NavTab (see
// AppBottomNav's extraSlot comment) -- it never takes the active-page
// pill state the real tabs do; instead it has exactly two visual states
// of its own (live/locked), independent of the current route.
//
// Live state navigates straight to /calm (a real destination, same
// min-h-[44px] flex-1 tap target as the other three tabs). Locked state
// is still tappable, but opens the unlock sheet instead of navigating --
// constraint 2B: "All other parents see the locked state (visible,
// tappable, upsell sheet)".
export function CalmNavButton() {
  const { isLive, childName, isLoading } = useParentCalmAccess();
  const [isUnlockSheetOpen, setIsUnlockSheetOpen] = useState(false);

  // While loading, render the locked shell rather than nothing -- an
  // empty 4th slot would jump/reflow the other three tabs the instant
  // the fetch resolves, and "locked" is the safe default (never shows a
  // false "live" pill before we actually know).
  const showLive = !isLoading && isLive;

  const pillClasses = showLive
    ? "bg-calm-pill"
    : "relative bg-[#e7e5ea]";
  const iconClasses = showLive ? "text-calm-ink" : "text-brand-neutral-black/40";
  const labelClasses = showLive
    ? "font-semibold text-calm-ink"
    : "font-medium text-brand-neutral-black/40";

  const content = (
    <span className={`flex flex-col items-center gap-0.5 rounded-2xl px-3.5 py-1.5 ${pillClasses}`}>
      <LifeBuoy aria-hidden size={24} strokeWidth={2} className={iconClasses} />
      <span className={`font-sans text-[10px] leading-none ${labelClasses}`}>Calm</span>
      {!showLive && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm"
        >
          <Lock size={10} strokeWidth={2.5} className="text-brand-neutral-black/50" />
        </span>
      )}
    </span>
  );

  if (showLive) {
    return (
      <Link
        href="/calm"
        aria-label="Calm"
        className="flex min-h-[44px] flex-1 items-center justify-center"
      >
        {content}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label="Calm (locked)"
        onClick={() => setIsUnlockSheetOpen(true)}
        className="flex min-h-[44px] flex-1 items-center justify-center"
      >
        {content}
      </button>
      <CalmUnlockSheet
        isOpen={isUnlockSheetOpen}
        onClose={() => setIsUnlockSheetOpen(false)}
        childName={childName}
      />
    </>
  );
}
