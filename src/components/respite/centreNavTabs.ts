import { House, Users, Mail, UserCog, Settings } from "lucide-react";
import type { NavTab } from "@/components/ui/AppBottomNav";

// The centre_manager dashboard build, 25 Sept 2026 -- mirrors
// principalNavTabs.ts's own shape exactly (one array, consumed by both
// CentreSidebar and CentreBottomNav so neither hardcodes its own copy
// of the same hrefs/isActive matchers). No Incidents (a centre never
// produces one -- can_own_incident()/create_incident_stamp() stay
// untouched and out of reach, per 0296's own confirmed scoping).
//
// Respite UI Stage 2b -- Messages added. General staff-to-staff
// messaging for centre_manager/care_staff is STILL out of scope
// (confirmed again by re-grepping every message_categories insert
// before building this -- no applies_to 'staff' category has ever been
// widened to admit either role) -- this tab is specifically the
// handover inbox (migration 0311's get_my_handover_messages()), not a
// general inbox. Composing still lives on a child's own record
// (RespiteChildRecord, reached via Children); this tab is where
// reading them across every child now happens.
export const CENTRE_NAV_TABS: NavTab[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: House,
    href: "/centre/dashboard",
    isActive: (pathname) => pathname === "/centre/dashboard",
  },
  {
    key: "children",
    label: "Children",
    icon: Users,
    href: "/centre/children",
    isActive: (pathname) => pathname.startsWith("/centre/children") || pathname.startsWith("/centre/passport"),
  },
  {
    key: "messages",
    label: "Messages",
    icon: Mail,
    href: "/centre/messages",
    isActive: (pathname) => pathname.startsWith("/centre/messages"),
  },
  {
    key: "staff",
    label: "Staff",
    icon: UserCog,
    href: "/centre/staff",
    isActive: (pathname) => pathname.startsWith("/centre/staff"),
  },
  // Outstanding-task snoozing, 25 Sept 2026 -- the brief's own words:
  // "N is configurable per institution, on that institution's own
  // settings screen -- School, Clinic, and the Centre screen WHEN IT
  // EXISTS." It didn't; this is that screen's first real setting.
  {
    key: "settings",
    label: "Settings",
    icon: Settings,
    href: "/centre/settings",
    isActive: (pathname) => pathname.startsWith("/centre/settings"),
  },
];
