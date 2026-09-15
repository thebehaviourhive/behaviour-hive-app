import { PrincipalSidebar } from "@/components/principal/PrincipalSidebar";
import { PrincipalSupportAlertProvider } from "@/components/principal/PrincipalSupportAlertProvider";

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
//
// min-w-0 on the content div -- found live on the clinician track's own
// copy of this exact file (clinician desktop pass, Stage 2) and fixed
// here too, same day. Without it, this div is a flex ITEM of the row
// above (`flex min-h-full flex-1`), and a flex item's default min-width
// is `auto`: it refuses to shrink below its own content's intrinsic
// width. Any overflow-x-auto scroller inside (a horizontal tab strip, a
// stat-card carousel) sets that intrinsic width to its own full
// unscrolled size, and the WHOLE PAGE grows to match at mobile widths
// instead of the scroller containing its own overflow. Confirmed
// dormant here at the time this was found -- no principal page
// currently has wide enough overflow-x-auto content to trigger it
// visibly -- but it's the identical bug, copied verbatim into this
// file first and into clinician/layout.tsx second, and it fires the
// moment any future principal screen gets a wide scrollable child.
// Fixed pre-emptively rather than left as a documented landmine.
export default function PrincipalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Item 7 investigation fix, 15 Sept 2026 -- one poll for the whole
    // principal session, shared by PrincipalSidebar and every page's own
    // PrincipalBottomNav via context (see PrincipalSupportAlertProvider's
    // own header comment). Previously each ran its own.
    <PrincipalSupportAlertProvider>
      <div className="flex min-h-full flex-1">
        <PrincipalSidebar />
        <div className="flex min-h-full min-w-0 flex-1 flex-col lg:pl-64">{children}</div>
      </div>
    </PrincipalSupportAlertProvider>
  );
}
