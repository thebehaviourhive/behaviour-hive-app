"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CalmCard } from "@/lib/calmCards/types";

// Swipe threshold (px) before a drag commits to advance/retreat instead
// of springing back -- roughly a third of a typical 375px viewport's
// card width, tuned so a deliberate swipe registers well before the
// finger reaches the screen edge, but an accidental brush doesn't.
const SWIPE_THRESHOLD = 60;
// Below this angle ratio, a touch is treated as vertical scroll/pull
// intent, not a card swipe -- constraint: "must not conflict with any
// pull/scroll behaviour". A touch is only ever claimed as a horizontal
// swipe once it's moved clearly more horizontally than vertically;
// until that's true, the browser's own native scroll/pull handling is
// left completely alone (no preventDefault).
const DIRECTION_LOCK_RATIO = 1.3;

interface DragState {
  startX: number;
  startY: number;
  deltaX: number;
  isHorizontal: boolean | null; // null = not yet decided
}

// One card fills the screen; horizontal swipe advances/retreats with a
// subtle next-card edge peek; the deck LOOPS (index arithmetic uses
// modulo, so there is no "last card" boundary a swipe can fall off of).
// [Try another] is the accessible, redundant, non-gesture path
// (screen readers, motor accessibility) -- it's a plain button, not a
// simulated swipe, so it works identically regardless of touch support.
//
// footer is a slot for Stage 3's safety-line footer -- deliberately NOT
// reachable by any swipe gesture in this component (there is no gesture
// that can trigger it at all; it will only ever be a real tap target
// rendered by the caller). Kept as an explicit slot rather than this
// component reaching into Stage 3 concerns itself.
export function CalmCardCarousel({
  cards,
  childName,
  footer,
  onCardShown,
}: {
  cards: CalmCard[];
  childName: string;
  footer?: ReactNode;
  // Fires once per card that becomes visible (including the first, on
  // mount) -- CalmFlow accumulates these into calm_episodes.cards_shown.
  // A plain effect on [index], not folded into go()/handleTouchEnd,
  // since a card can also become "shown" via the initial index=0 render,
  // which those functions never run for.
  onCardShown?: (cardId: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const touchAreaRef = useRef<HTMLDivElement | null>(null);

  const count = cards.length;
  const isLastCard = index === count - 1;

  function go(delta: 1 | -1) {
    setIndex((i) => (i + delta + count) % count);
    setDragOffset(0);
  }

  // Touch listeners are attached manually (not via JSX onTouch* props)
  // specifically so touchmove can be registered { passive: false } --
  // React's synthetic touch handlers are passive by default since
  // React 17, which silently makes event.preventDefault() a no-op
  // inside a plain onTouchMove prop. That's exactly the failure mode
  // that would let iOS Safari's native scroll/rubber-band fight a
  // horizontal swipe instead of yielding to it (constraint: "verify on
  // the iOS PWA specifically" -- this is the concrete iOS-specific risk
  // that check is guarding against, hardened directly rather than left
  // to a device test this environment can't run).
  useEffect(() => {
    const el = touchAreaRef.current;
    if (!el) return;

    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      dragRef.current = { startX: touch.clientX, startY: touch.clientY, deltaX: 0, isHorizontal: null };
      setIsDragging(true);
    }

    function handleTouchMove(e: TouchEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const touch = e.touches[0];
      const dx = touch.clientX - drag.startX;
      const dy = touch.clientY - drag.startY;

      if (drag.isHorizontal === null) {
        // Not yet enough movement to decide -- let the browser handle it
        // (don't preventDefault) until direction is clear.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        drag.isHorizontal = Math.abs(dx) > Math.abs(dy) * DIRECTION_LOCK_RATIO;
      }

      if (!drag.isHorizontal) return; // vertical drag: native scroll/pull owns this touch entirely

      e.preventDefault();
      drag.deltaX = dx;
      setDragOffset(dx);
    }

    function handleTouchEnd() {
      const drag = dragRef.current;
      dragRef.current = null;
      setIsDragging(false);
      if (!drag?.isHorizontal) {
        setDragOffset(0);
        return;
      }
      if (drag.deltaX <= -SWIPE_THRESHOLD) go(1);
      else if (drag.deltaX >= SWIPE_THRESHOLD) go(-1);
      else setDragOffset(0);
    }

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- go() closes over `count`, which only ever changes with a fresh `cards` prop (a new deck), and re-binding listeners on every count change is exactly the correct behaviour, not a missing-dep bug.
  }, [count]);

  const card = cards[index];

  useEffect(() => {
    if (card) onCardShown?.(card.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on card.id, not the onCardShown identity, so this doesn't re-fire for the SAME card on every parent re-render.
  }, [card?.id]);

  if (!card) return null;

  return (
    <div className="flex h-full flex-col">
      <div ref={touchAreaRef} className="relative flex-1 touch-pan-y overflow-hidden">
        {/* Edge peeks -- subtle hint of the previous/next card, static
            (not dragged) so they read as "there's more" without being a
            second interactive surface. */}
        <div className="pointer-events-none absolute inset-y-4 -left-4 w-8 rounded-3xl bg-calm-pill/40" aria-hidden />
        <div className="pointer-events-none absolute inset-y-4 -right-4 w-8 rounded-3xl bg-calm-pill/40" aria-hidden />

        <div
          className="relative flex h-full flex-col justify-center rounded-3xl bg-white p-6 shadow-md"
          style={{
            transform: `translateX(${dragOffset}px)`,
            transition: isDragging ? "none" : "transform 220ms ease-out",
          }}
        >
          <div aria-hidden className="mb-4 h-1.5 w-16 rounded-full bg-calm-pill" />
          <h1 className="font-heading text-3xl font-bold leading-tight text-brand-neutral-black">{card.title}</h1>
          <ol className="mt-6 flex flex-col gap-5">
            {card.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-calm-pill text-base font-bold text-calm-ink">
                  {i + 1}
                </span>
                <span className="pt-0.5 text-xl leading-snug text-brand-neutral-black">{step}</span>
              </li>
            ))}
          </ol>

          {isLastCard && (
            <p className="mt-8 text-sm text-brand-neutral-black/60">
              You&apos;ve seen all of {childName}&apos;s Calm Cards — keep going, or tap below for more support.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 pt-4">
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Calm Card position">
          {cards.map((c, i) => (
            <span
              key={c.id}
              aria-hidden
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-calm-ink" : "w-1.5 bg-calm-ink/25"}`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => go(1)}
          className="rounded-full border-2 border-calm-ink px-6 py-2.5 text-sm font-semibold text-calm-ink"
        >
          Try another
        </button>
      </div>

      {footer}
    </div>
  );
}
