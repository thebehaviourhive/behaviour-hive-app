import { House, Mail, Menu } from "lucide-react";
import type { NavTab } from "@/components/ui/AppBottomNav";

// Respite UI Stage 2b -- /care/* had NO nav shell at all before this:
// no layout.tsx, no sidebar, no bottom nav, two standalone page files
// with nothing connecting them but the browser's own back button.
// Daniel's own words: "care staff are the primary audience... a care
// worker inside a child's record with no nav can't get anywhere."
//
// PRIORITY FIX, 26 Sept 2026 -- "More" added. Not a new pattern: this
// is exactly clinicianNavTabs.ts's own "More" entry, same href
// (/more), same icon, same reasoning -- a role with no dedicated
// settings destination of its own reaches Log out the way clinician/
// class_teacher/sna/parent already do. Found while fixing a real
// safeguarding gap: care_staff had NO way to log out anywhere, and a
// device left signed in on a shared centre floor is a real access risk
// to children's records.
export const CARE_NAV_TABS: NavTab[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: House,
    href: "/care/dashboard",
    isActive: (pathname) => pathname === "/care/dashboard" || pathname.startsWith("/care/passport"),
  },
  {
    key: "messages",
    label: "Messages",
    icon: Mail,
    href: "/care/messages",
    isActive: (pathname) => pathname.startsWith("/care/messages"),
  },
  {
    key: "more",
    label: "More",
    icon: Menu,
    href: "/more",
    isActive: (pathname) => pathname.startsWith("/more"),
  },
];
