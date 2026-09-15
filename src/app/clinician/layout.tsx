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
export default function ClinicianLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-1">
      <ClinicianSidebar />
      <div className="flex min-h-full flex-1 flex-col lg:pl-64">{children}</div>
    </div>
  );
}
