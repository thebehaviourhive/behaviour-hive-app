import { House, BookUser, Menu } from "lucide-react";
import { AppBottomNav, type NavTab } from "./AppBottomNav";

// Parent track's tab list. "Passport" owns every /passport/* route (the
// section wizard as well as the dashboard); "More" owns /more; everything
// else on this track (dashboard, its activity history, and the
// dashboard-launched resources/messages/morning-checkin destinations)
// falls back to "Home" as the default.
export function BottomNav({ passportHref }: { passportHref?: string }) {
  const tabs: NavTab[] = [
    {
      key: "home",
      label: "Home",
      icon: House,
      href: "/parent-dashboard",
      isActive: (pathname) => !pathname.startsWith("/passport") && !pathname.startsWith("/more"),
    },
    {
      key: "passport",
      label: "Passport",
      icon: BookUser,
      href: passportHref,
      isActive: (pathname) => pathname.startsWith("/passport"),
    },
    {
      key: "more",
      label: "More",
      icon: Menu,
      href: "/more",
      isActive: (pathname) => pathname.startsWith("/more"),
    },
  ];

  return <AppBottomNav tabs={tabs} />;
}
