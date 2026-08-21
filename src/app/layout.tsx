import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito_Sans, Quicksand } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import PreventPinchZoom from "./PreventPinchZoom";

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
        <PreventPinchZoom />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
