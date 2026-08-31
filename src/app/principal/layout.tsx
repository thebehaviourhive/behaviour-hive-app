import { PrincipalSidebar } from "@/components/principal/PrincipalSidebar";

// PRD 4, Stage 1 -- the first nested layout anywhere in this app.
// Every other track manages its own full page shell independently,
// including rendering its own bottom nav; this is the first route
// segment to get a shared layout.tsx at all.
//
// Wraps every /principal/* route -- the four tab pages and the three
// drill-down sub-routes (classes/[classId], passports/[passportId],
// passports/enrol) alike -- in exactly one new element: PrincipalSidebar,
// visible at lg+ only. No existing page file changed to get this: each
// page's own root div (its background, its own <PrincipalBottomNav />,
// its pb-24 mobile clearance) is untouched, this layout only sits
// beside it and shifts it right via lg:pl-64 to clear the sidebar's
// own 256px (w-64) width. Below lg, this layout renders nothing visible
// at all -- PrincipalSidebar is hidden there, and lg:pl-64 does
// nothing below its own breakpoint -- so every principal screen's
// mobile rendering is unchanged by this file's existence.
//
// The three drill-down sub-routes don't render PrincipalBottomNav
// today (a deliberate existing pattern: full-screen detail views with
// a back-chevron, no tab bar) and still won't at <lg. At lg+ they now
// pick up the sidebar for the first time, same as the four tab pages --
// consistent, and worth Daniel's own 1280px pass rather than assumed
// correct.
export default function PrincipalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-1">
      <PrincipalSidebar />
      <div className="flex min-h-full flex-1 flex-col lg:pl-64">{children}</div>
    </div>
  );
}
