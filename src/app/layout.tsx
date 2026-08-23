import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito_Sans, Quicksand } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import PreventPinchZoom from "./PreventPinchZoom";
import BrandedLaunchShell from "./BrandedLaunchShell";

const baloo2 = Baloo_2({
  variable: "--font-baloo-2",
  subsets: ["latin"],
});

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
});

const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "The Behaviour Hive",
  description: "The Behaviour Hive",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "The Behaviour Hive",
    // PWA cold-start fix: without this, iOS has no device-sized splash
    // to show at all and falls back to a bare black/white frame while
    // the webview spins up. Generated via
    // scripts/generate-startup-images.mjs -- Prussian Blue + the white
    // logo, matching manifest.ts's background_color and
    // src/app/loading.tsx exactly.
    startupImage: [
      {
        url: "/icons/startup/startup-750x1334.png",
        media:
          "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
      {
        url: "/icons/startup/startup-828x1792.png",
        media:
          "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
      {
        url: "/icons/startup/startup-1125x2436.png",
        media:
          "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/icons/startup/startup-1242x2688.png",
        media:
          "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/icons/startup/startup-1170x2532.png",
        media:
          "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/icons/startup/startup-1284x2778.png",
        media:
          "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/icons/startup/startup-1179x2556.png",
        media:
          "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/icons/startup/startup-1290x2796.png",
        media:
          "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/icons/startup/startup-1206x2622.png",
        media:
          "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/icons/startup/startup-1320x2868.png",
        media:
          "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
    ],
  },
  icons: {
    icon: [
      { url: "/icons/passport-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/passport-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/passport-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/passport-icon-180.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#004F71",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Lets content render edge-to-edge on notched/home-indicator devices so
  // the bottom nav's env(safe-area-inset-bottom) padding (AppBottomNav)
  // has a real inset to read instead of resolving to 0.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${baloo2.variable} ${nunitoSans.variable} ${quicksand.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* PWA cold-start fix: first thing in body, ahead of
            everything else including {children} -- not gated behind
            any auth/role check, so it's part of the raw SSR'd HTML
            and covers the full screen from the very first paint. See
            BrandedLaunchShell.tsx for what it does and doesn't cover. */}
        <BrandedLaunchShell />
        <PreventPinchZoom />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
