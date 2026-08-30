"use client";

import { House, TriangleAlert, Users, School as SchoolIcon } from "lucide-react";
import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";

// PRD 2, Stage 1. Matches TeacherBottomNav/ClinicianBottomNav/
// SnaBottomNav's own established shape exactly -- a thin per-track
// TABS list rendered through the one shared AppBottomNav renderer, not
// a new nav implementation. No message-badge complexity (no Messages
// tab on this track), so unlike the other three, this one needs no own
// userId fetch at all -- genuinely simpler, not a shortcut.
//
// "Directory" owns Staff, Classes, Passports, and (Stage 6) Temporary
// Access -- still-separate routes (Stages 2/3/5/6 reconcile their own
// content; this stage only gives them a shared destination and a
// shared active-tab state).
// "School" owns the new /principal/school landing (account
// administration, settings) that this same stage introduces.
export function PrincipalBottomNav() {
  const TABS: NavTab[] = [
    {
      key: "dashboard",
      label: "Dashboard",
      icon: House,
      href: "/principal/dashboard",
      isActive: (pathname) => pathname === "/principal/dashboard",
    },
    {
      key: "incidents",
      label: "Incidents",
      icon: TriangleAlert,
      href: "/principal/incidents",
      isActive: (pathname) => pathname.startsWith("/principal/incidents"),
    },
    {
      key: "directory",
      label: "Directory",
      icon: Users,
      href: "/principal/directory",
      isActive: (pathname) =>
        pathname.startsWith("/principal/directory") ||
        pathname.startsWith("/principal/staff") ||
        pathname.startsWith("/principal/classes") ||
        pathname.startsWith("/principal/passports") ||
        pathname.startsWith("/principal/temporary-access"),
    },
    {
      key: "school",
      label: "School",
      icon: SchoolIcon,
      href: "/principal/school",
      isActive: (pathname) => pathname.startsWith("/principal/school"),
    },
  ];

  // Widened past AppBottomNav's own max-w-sm default -- measured live at
  // 1280px (Stage 1's own review): the shared default left the four tabs
  // clustered in a 384px strip centred inside a full-width white bar,
  // real dead space either side, on the laptop/iPad width principals
  // mostly use this on. Opt-in only (maxWidthClassName), the other four
  // tracks' own nav is untouched.
  return <AppBottomNav tabs={TABS} maxWidthClassName="max-w-2xl" />;
}
