import { House, Users, UserCog } from "lucide-react";
import type { NavTab } from "@/components/ui/AppBottomNav";

// The centre_manager dashboard build, 25 Sept 2026 -- mirrors
// principalNavTabs.ts's own shape exactly (one array, consumed by both
// CentreSidebar and CentreBottomNav so neither hardcodes its own copy
// of the same hrefs/isActive matchers), sized to what a respite centre
// actually has: three destinations, not five. No Incidents (a centre
// never produces one -- can_own_incident()/create_incident_stamp()
// stay untouched and out of reach, per 0296's own confirmed scoping).
// No Messages tab: general staff-to-staff messaging for centre_manager/
// care_staff was deliberately left unbuilt at 0296 ("no respite
// messaging UI exists yet to consume it" -- confirmed by reading that
// migration's own header directly before deciding this) -- a tab
// pointing at a screen with nothing to send under is worse than no tab.
// Child-scoped Handover messaging is unaffected; it lives inside
// RespiteChildRecord, reached via Children -> a child's own record.
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
    key: "staff",
    label: "Staff",
    icon: UserCog,
    href: "/centre/staff",
    isActive: (pathname) => pathname.startsWith("/centre/staff"),
  },
];
