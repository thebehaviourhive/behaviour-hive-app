interface BrandMarkProps {
  size?: number;
}

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
export function BrandMark({ size = 56 }: BrandMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the comment above the component: next/image's pipeline is for photos, not this.
    <img
      src="/brand/behaviour-passport-mark-blue.svg"
      alt="Behaviour Passport"
      width={size}
      height={size}
    />
  );
}
