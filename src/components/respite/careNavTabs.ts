import { House, Mail } from "lucide-react";
import type { NavTab } from "@/components/ui/AppBottomNav";

// Respite UI Stage 2b -- /care/* had NO nav shell at all before this:
// no layout.tsx, no sidebar, no bottom nav, two standalone page files
// with nothing connecting them but the browser's own back button.
// Daniel's own words: "care staff are the primary audience... a care
// worker inside a child's record with no nav can't get anywhere."
//
// Two destinations, not centre's four -- care_staff has no placement
// management, no staff roster, no settings of their own to reach.
// Dashboard (their own activated children + on-call) and Messages
// (the handover inbox this stage builds) are the whole of it.
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
];
