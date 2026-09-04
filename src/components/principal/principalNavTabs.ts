import { House, Mail, TriangleAlert, Users, School as SchoolIcon } from "lucide-react";
import type { NavTab } from "@/components/ui/AppBottomNav";

// PRD 4, Stage 1 -- the one place the principal track's four top-level
// destinations are defined. PrincipalBottomNav (375px) and
// PrincipalSidebar (1280px, new this stage) both import this instead
// of each hardcoding their own copy of the same four hrefs and
// isActive matchers -- Stage 1's own recon found back-chevrons and a
// landing-route hardcoded in more than one place already (CLAUDE.md);
// a second nav surface duplicating these four by hand would be that
// same pattern again. Content and matchers unchanged from
// PrincipalBottomNav's own pre-Stage-1 definition -- lifted out, not
// altered.
export const PRINCIPAL_NAV_TABS: NavTab[] = [
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
  // Migration 0161 -- a principal can now be addressed on a thread and
  // start one (scoped to their own institution's children); "messages"
  // is a real fifth destination, not a placeholder. badgeCount is
  // injected by each consumer (PrincipalBottomNav/PrincipalSidebar),
  // same as every field on this base array that varies per render --
  // this file only owns the destinations themselves.
  {
    key: "messages",
    label: "Messages",
    icon: Mail,
    href: "/principal/messages",
    isActive: (pathname) => pathname.startsWith("/principal/messages"),
  },
];
