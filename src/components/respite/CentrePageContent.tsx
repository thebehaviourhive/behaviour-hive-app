// Respite UI Stage 1, item 3 -- measured live at the same width, the
// four /centre screens each had their own content container: dashboard
// centred at a narrow max-w-sm (items-center on its <main>), Staff and
// Children each centred at max-w-2xl via mx-auto, the child record and
// the report screen with no container at all (genuinely full-bleed).
// Nothing lined up between screens because nothing shared a container.
//
// The fix reuses the pattern School and Clinic settings already
// established (/principal/school, /principal/clinic) rather than
// inventing a second one: a plain block child capped at
// lg:max-w-[66.6667%], no mx-auto, no items-center on its own <main>.
// A block box with no auto margins hugs its container's left edge by
// default -- that absence is the whole mechanism, not a class to add.
export function CentrePageContent({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`lg:max-w-[66.6667%] ${className}`.trim()}>{children}</div>;
}
