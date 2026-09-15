import { ClinicianSidebar } from "@/components/clinician/ClinicianSidebar";

// Clinician desktop pass, Stage 1 -- the second nested layout in this
// app, following src/app/principal/layout.tsx's own pattern exactly
// (PRD 4, Stage 1).
//
// Wraps every /clinician/* route -- the four tab pages and every
// drill-down sub-route (passport/[passportId], fba/[fbaId],
// fba/[fbaId]/section/[sectionId], fba/[fbaId]/section/7/interview/
// [interviewId], verify, specialty, resources) alike -- in exactly one
// new element: ClinicianSidebar, visible at lg+ only. No existing page
// file changed to get this: each page's own root div (its background,
// its own <ClinicianBottomNav />, its own mobile clearance) is
// untouched, this layout only sits beside it and shifts it right via
// lg:pl-64 to clear the sidebar's own 256px (w-64) width. Below lg,
// this layout renders nothing visible at all -- ClinicianSidebar is
// hidden there, and lg:pl-64 does nothing below its own breakpoint --
// so every clinician screen's mobile rendering is unchanged by this
// file's existence.
//
// min-w-0 on the content div, found and fixed in Stage 2 -- without it,
// this div is a flex ITEM of the row above (`flex min-h-full flex-1`),
// and a flex item's default min-width is `auto`: it refuses to shrink
// below its own content's intrinsic width. Any overflow-x-auto scroller
// inside (a horizontal tab strip, a stat-card carousel) sets that
// intrinsic width to its own full unscrolled content size, and the
// WHOLE PAGE grows to match instead of the scroller containing its own
// overflow -- confirmed live: the plain clinician dashboard already
// scrolled horizontally at 375px (796px of actual content) before this
// fix, and Stage 2's eleven-item tab strip made it severe (1128px).
// This exact pattern was copied verbatim from principal/layout.tsx
// (PRD 4, Stage 1) -- that file has the identical latent bug, not fixed
// here since it's outside this stage's scope, flagged separately.
export default function ClinicianLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-1">
      <ClinicianSidebar />
      <div className="flex min-h-full min-w-0 flex-1 flex-col lg:pl-64">{children}</div>
    </div>
  );
}
