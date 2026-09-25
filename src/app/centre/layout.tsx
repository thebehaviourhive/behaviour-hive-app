import { CentreSidebar } from "@/components/respite/CentreSidebar";

// The centre_manager dashboard build, 25 Sept 2026 -- /centre/* had no
// layout.tsx at all before this: no sidebar, no bottom nav, three
// standalone page files with nothing connecting them but the browser's
// own back button. Mirrors principal/layout.tsx exactly (same lg:pl-64
// shift, same min-w-0 fix applied from the start this time rather than
// found live later -- see that file's own header for why it matters).
// No PrincipalSupportAlertProvider-equivalent: a respite centre never
// raises a Support Button alert, so there is nothing to poll for.
export default function CentreLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-1">
      <CentreSidebar />
      <div className="flex min-h-full min-w-0 flex-1 flex-col lg:pl-64">{children}</div>
    </div>
  );
}
