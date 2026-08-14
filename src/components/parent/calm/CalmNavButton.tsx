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

  // Three real states, not two. isLoading here means "the SESSION's
  // first-ever fetch is still in flight" (see useParentCalmAccess's
  // module-level cache) -- genuinely reachable only once per tab, never
  // on the repeat per-page remounts BottomNav goes through on every
  // in-app navigation (that repeat-remount-then-flash-locked was the
  // regression this replaces). Rendering the SAME pill shape here (not
  // an empty slot) keeps the other three tabs from jumping/reflowing
  // once the real answer arrives; rendering it NEUTRAL rather than
  // defaulting to locked is the actual fix -- a brief "don't know yet"
  // is honest, guessing wrong and flashing it is the bug. Not a <Link>
  // or a <button onClick>: genuinely inert, so a tap during this brief
  // window can never open the unlock sheet on what might turn out to be
  // a live account.
  if (isLoading) {
    return (
      <span className="flex min-h-[44px] flex-1 items-center justify-center">
        <span className="flex animate-pulse flex-col items-center gap-0.5 rounded-2xl bg-black/5 px-3.5 py-1.5">
          <LifeBuoy aria-hidden size={24} strokeWidth={2} className="text-brand-neutral-black/20" />
          <span className="font-sans text-[10px] leading-none font-medium text-brand-neutral-black/20">
            Calm
          </span>
        </span>
      </span>
    );
  }

  const pillClasses = isLive ? "bg-calm-pill" : "relative bg-[#e7e5ea]";
  const iconClasses = isLive ? "text-calm-ink" : "text-brand-neutral-black/40";
  const labelClasses = isLive ? "font-semibold text-calm-ink" : "font-medium text-brand-neutral-black/40";

  const content = (
    <span className={`flex flex-col items-center gap-0.5 rounded-2xl px-3.5 py-1.5 ${pillClasses}`}>
      <LifeBuoy aria-hidden size={24} strokeWidth={2} className={iconClasses} />
      <span className={`font-sans text-[10px] leading-none ${labelClasses}`}>Calm</span>
      {!isLive && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm"
        >
          <Lock size={10} strokeWidth={2.5} className="text-brand-neutral-black/50" />
        </span>
      )}
    </span>
  );

  if (isLive) {
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
