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
// "Directory" owns Staff, Classes and Passports -- three still-separate
// routes today (Stages 2/3/5 reconcile their content; this stage only
// gives them a shared destination and a shared active-tab state).
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
        pathname.startsWith("/principal/passports"),
    },
    {
      key: "school",
      label: "School",
      icon: SchoolIcon,
      href: "/principal/school",
      isActive: (pathname) => pathname.startsWith("/principal/school"),
    },
  ];

  return <AppBottomNav tabs={TABS} />;
}
