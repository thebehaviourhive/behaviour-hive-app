import { CareSidebar } from "@/components/respite/CareSidebar";

// Respite UI Stage 2b -- /care/* had no layout.tsx at all, the same gap
// CentreLayout.tsx closed for centre_manager (25 Sept 2026). No
// PrincipalSupportAlertProvider-equivalent, same reason CentreLayout
// has none: a respite centre never raises a Support Button alert.
export default function CareLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-full flex-1">
      <CareSidebar />
      <div className="flex min-h-full min-w-0 flex-1 flex-col lg:pl-64">{children}</div>
    </div>
  );
}
