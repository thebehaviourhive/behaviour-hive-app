import { House, Users, Menu } from "lucide-react";
import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";

// Teacher track's tab list. "Students" owns the roster plus any
// per-student view reached from it (a student's classroom profile and the
// end-of-day wizard); "More" owns /more; everything else on this track
// (dashboard, its activity history, the morning grid, ABC log, and the
// dashboard-launched resources/messages) falls back to "Dashboard" as the
// default.
const TABS: NavTab[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: House,
    href: "/teacher/dashboard",
    isActive: (pathname) =>
      pathname.startsWith("/teacher") &&
      !pathname.startsWith("/teacher/students") &&
      !pathname.startsWith("/teacher/passport/") &&
      !pathname.startsWith("/teacher/eod/"),
  },
  {
    key: "students",
    label: "Students",
    icon: Users,
    href: "/teacher/students",
    isActive: (pathname) =>
      pathname.startsWith("/teacher/students") ||
      pathname.startsWith("/teacher/passport/") ||
      pathname.startsWith("/teacher/eod/"),
  },
  {
    key: "more",
    label: "More",
    icon: Menu,
    href: "/more",
    isActive: (pathname) => pathname.startsWith("/more"),
  },
];

export function TeacherBottomNav() {
  return <AppBottomNav tabs={TABS} />;
}
