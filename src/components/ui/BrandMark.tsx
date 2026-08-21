interface BrandMarkProps {
  size?: number;
  // "light" (default): the standard blue-on-white mark, for every
  // light-background surface in the app. "dark-bg": the white variant,
  // for a Prussian-blue (or otherwise dark) background -- the blue
  // mark's main fill (#004F71) is IDENTICAL to bg-brand-prussian-blue
  // itself, so it's literally invisible there without this. Declared
  // per-surface through this one prop rather than a hardcoded file
  // path sprinkled wherever a dark background shows up, so the next
  // dark-bg surface is a one-line change, not a rediscovery of this
  // same bug.
  variant?: "light" | "dark-bg";
}

const MARK_SRC: Record<NonNullable<BrandMarkProps["variant"]>, string> = {
  light: "/brand/behaviour-passport-mark-blue.svg",
  "dark-bg": "/brand/behaviour-passport-mark-white.svg",
};

// Plain <img>, not next/image: this is a small vector mark, not a
// photo -- next/image's optimisation pipeline (responsive srcsets,
// blur placeholders, remote loader) has nothing to offer it, and
// serving an SVG through next/image needs `images.dangerouslyAllowSVG`
// turned on in next.config, which just isn't a trade worth making for
// something a plain tag already renders correctly.
//
// No rounded-full clip (the old bee-in-circle mark wore one; this
// passport-silhouette mark's own artwork already reaches close to the
// top/bottom of its square canvas, so a circular mask would visibly
// clip it) -- the SVG's own shape is the whole logomark now.
export function BrandMark({ size = 56, variant = "light" }: BrandMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the comment above the component: next/image's pipeline is for photos, not this.
    <img src={MARK_SRC[variant]} alt="Behaviour Passport" width={size} height={size} />
  );
}
