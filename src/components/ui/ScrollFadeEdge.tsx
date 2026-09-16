// Stage 5, item (tab-strip affordance): a horizontally-scrolling tab
// strip with more tabs than fit gives no signal that more exist --
// found on ChildDetail.tsx's and the teacher passport page's own ten-
// tab strips at 375px, where the cut is a clean edge with nothing
// hinting there's more to scroll to. No fade/scroll-hint pattern
// existed anywhere in this codebase to reuse (checked first) -- the
// closest visual precedent is CalmCardCarousel's own "edge peek"
// (a static, pointer-events-none, aria-hidden translucent block at each
// edge, not scroll-position-reactive) -- this follows that same static,
// non-interactive posture, but as a genuine fade (transparent -> the
// page's own background) rather than a solid block, since a solid block
// would obscure the partially-visible next tab's own label text instead
// of hinting at it.
//
// Static, not scroll-position-driven, matching the CalmCardCarousel
// precedent's own reasoning: a simple, always-present hint reads as
// "there's more" without needing scroll-event tracking to hide itself
// at the true end.
export function ScrollFadeEdge({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-brand-off-white to-transparent ${className}`}
    />
  );
}
