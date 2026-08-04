import { House, FolderOpen, Menu } from "lucide-react";
import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";

// Clinician track's tab list. "Passports" owns the caseload list plus any
// individual case's clinical file; "More" owns /more; everything else on
// this track (dashboard, its activity history, the Add Log flow, and the
// dashboard-launched resources/messages) falls back to "Dashboard" as the
// default.
const TABS: NavTab[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: House,
    href: "/clinician/dashboard",
    isActive: (pathname) =>
      pathname.startsWith("/clinician") &&
      !pathname.startsWith("/clinician/passports") &&
      !pathname.startsWith("/clinician/passport/"),
  },
  {
    key: "passports",
    label: "Passports",
    icon: FolderOpen,
    href: "/clinician/passports",
    isActive: (pathname) =>
      pathname.startsWith("/clinician/passports") || pathname.startsWith("/clinician/passport/"),
  },
  {
    key: "more",
    label: "More",
    icon: Menu,
    href: "/more",
    isActive: (pathname) => pathname.startsWith("/more"),
  },
];

export function ClinicianBottomNav() {
  return <AppBottomNav tabs={TABS} />;
}
