"use client";

import { useEffect, useRef, useState } from "react";
import type { FbaSectionDef } from "@/lib/fba/sections";

// Screen-only navigation for the parent reader's 14-section continuous
// scroll (the clinician's own workspace never shares this component --
// its equivalent view is a section-by-section list, not one continuous
// page, so there's nothing to apply this to there). Renders INSIDE the
// page's existing sticky header, not as its own separate sticky
// context -- the bubble row and the title strip both stick together
// with the back-button/title row above them, as one combined unit,
// rather than each needing independent `top` offset math.
export function FbaReaderNav({ sections }: { sections: FbaSectionDef[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const bubbleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  // Suppressed while a tap-triggered smooth scroll is in flight, so the
  // observer doesn't fight the deliberate jump with its own "closest
  // section passing by" updates mid-animation (the flicker the brief
  // calls out explicitly).
  const isProgrammaticScrollRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(`fba-section-${section.slug}`))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    // The observer's "active zone" needs to sit BELOW the sticky header
    // (back+title row, bubbles, title strip all stuck together) --
    // measured from the real rendered header rather than a guessed
    // constant, so it stays correct regardless of content wrapping at
    // narrow widths. -70% on the bottom keeps the zone a thin band near
    // the top of the visible area (~20-30% of the viewport), so a
    // section is only "active" once it's genuinely the one being read,
    // not merely peeking into view at the bottom of the screen.
    const headerHeight = rootRef.current?.closest("header")?.getBoundingClientRect().height ?? 140;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScrollRef.current) return;
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const index = elements.indexOf(topMost.target as HTMLElement);
        if (index >= 0) setActiveIndex(index);
      },
      { rootMargin: `-${Math.round(headerHeight)}px 0px -70% 0px`, threshold: 0 }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  // Keeps the active bubble in view within the horizontally-scrolling
  // row, whether activeIndex changed from a tap or from the scroll spy.
  useEffect(() => {
    bubbleRefs.current[activeIndex]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeIndex]);

  function handleBubbleTap(index: number) {
    isProgrammaticScrollRef.current = true;
    setActiveIndex(index);
    const target = document.getElementById(`fba-section-${sections[index].slug}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.clearTimeout(resumeTimerRef.current);
    // Long enough for a same-page smooth scroll to have genuinely
    // finished, even for a jump the full length of the report.
    resumeTimerRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 900);
  }

  useEffect(() => {
    return () => window.clearTimeout(resumeTimerRef.current);
  }, []);

  const activeSection = sections[activeIndex];

  return (
    <div ref={rootRef}>
      <div className="scrollbar-hide mt-3 flex gap-2 overflow-x-auto pb-1">
        {sections.map((section, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={section.slug}
              ref={(el) => {
                bubbleRefs.current[index] = el;
              }}
              type="button"
              onClick={() => handleBubbleTap(index)}
              aria-current={isActive ? "true" : undefined}
              aria-label={`Jump to Section ${section.number}: ${section.title}`}
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm transition-all duration-200 ${
                isActive
                  ? "scale-110 bg-brand-prussian-blue font-bold text-white shadow ring-2 ring-brand-pastel-blue ring-offset-1"
                  : "bg-brand-off-white font-medium text-brand-neutral-black/60"
              }`}
            >
              {section.number}
            </button>
          );
        })}
      </div>

      <div className="-mx-4 mt-2 border-b border-black/5 bg-white/95 px-4 py-2 backdrop-blur-sm">
        <p className="truncate text-sm font-semibold text-brand-prussian-blue">
          {activeSection.number}. {activeSection.title}
        </p>
      </div>
    </div>
  );
}
