import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Behaviour Hive",
    short_name: "Behaviour Passport",
    description: "The Behaviour Hive",
    start_url: "/",
    display: "standalone",
    // PWA cold-start fix: this was the off-white app background, but
    // the actual first thing a cold launch shows (both the OS's own
    // manifest-driven splash, where supported, and the inline branded
    // shell in layout.tsx) is Prussian Blue with the white logo -- the
    // same colour src/app/loading.tsx already uses. Matching it here
    // means no colour jump between "OS splash" and "app's own loading
    // state"; a real apple-touch-startup-image set (layout.tsx) covers
    // iOS, which mostly ignores this field for its own splash.
    background_color: "#004F71",
    theme_color: "#004F71",
    icons: [
      {
        src: "/icons/passport-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/passport-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/passport-icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
