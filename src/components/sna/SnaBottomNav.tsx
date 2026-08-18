"use client";

import { House, Menu } from "lucide-react";
import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";

// SNA track's tab list -- deliberately just 2 tabs, per the brief.
// "Passports" owns the child list plus any individual child's scoped
// passport view; "More" owns /more. There is no Messages tab (Messages
// is fully excluded for SNA in v1 -- see migration 0065 §11) and no
// separate Students-style roster page -- Passports home IS the roster.
export function SnaBottomNav() {
  const TABS: NavTab[] = [
    {
      key: "passports",
      label: "Passports",
      icon: House,
      href: "/sna/passports",
      isActive: (pathname) => pathname.startsWith("/sna/passport"),
    },
    {
      key: "more",
      label: "More",
      icon: Menu,
      href: "/more",
      isActive: (pathname) => pathname.startsWith("/more"),
    },
  ];

  return <AppBottomNav tabs={TABS} />;
}
