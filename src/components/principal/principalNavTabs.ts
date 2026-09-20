import { House, Mail, TriangleAlert, Users, School as SchoolIcon, Stethoscope } from "lucide-react";
import type { NavTab } from "@/components/ui/AppBottomNav";
import type { InstitutionType } from "@/lib/institutionType";

// PRD 4, Stage 1 -- the one place the principal track's top-level
// destinations are defined. PrincipalBottomNav (375px) and
// PrincipalSidebar (1280px, new this stage) both import this instead
// of each hardcoding their own copy of the same hrefs and isActive
// matchers -- Stage 1's own recon found back-chevrons and a
// landing-route hardcoded in more than one place already (CLAUDE.md);
// a second nav surface duplicating these by hand would be that same
// pattern again.
//
// Clinical director's dashboard, Step 0 recon (Sept 2026): this used to
// be one flat, institution-type-agnostic array. Daniel's own framing --
// "the vocabulary translation handles labels, not destinations" -- is
// why that was wrong, not just incomplete: Incidents is not a concept a
// clinic can ever produce (create_incident_stamp() has required
// class-teacher/SNA access since 0069; a clinic institution will show
// "no incidents," forever, for real), and School's own settings
// (temporary cover start/cutoff time, incident locations) are
// school-day concepts with no clinic meaning at all. Two genuinely
// different destination sets now, not one set with relabelled tiles --
// the first time this file needs an institution type as an input,
// rather than a page one level down handling it alone.
export const PRINCIPAL_NAV_TABS_SCHOOL: NavTab[] = [
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

// Four items, not five: Incidents is dropped entirely -- not reduced,
// not shown empty, absent. "Clinic" replaces "School" as the settings
// destination -- institution code, clinic-wide scheduling settings
// (PRD 9's set_clinic_hours/set_booking_buffer_minutes/set_booking_
// window_days, which had working RPCs and no UI home anywhere until
// this), and account administration.
export const PRINCIPAL_NAV_TABS_CLINIC: NavTab[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: House,
    href: "/principal/dashboard",
    isActive: (pathname) => pathname === "/principal/dashboard",
  },
  {
    key: "directory",
    label: "Directory",
    icon: Users,
    href: "/principal/directory",
    isActive: (pathname) => pathname.startsWith("/principal/directory") || pathname.startsWith("/principal/passports"),
  },
  {
    key: "clinic",
    label: "Clinic",
    icon: Stethoscope,
    href: "/principal/clinic",
    isActive: (pathname) => pathname.startsWith("/principal/clinic"),
  },
  {
    key: "messages",
    label: "Messages",
    icon: Mail,
    href: "/principal/messages",
    isActive: (pathname) => pathname.startsWith("/principal/messages"),
  },
];

export function getPrincipalNavTabs(institutionType: InstitutionType): NavTab[] {
  return institutionType === "clinic" ? PRINCIPAL_NAV_TABS_CLINIC : PRINCIPAL_NAV_TABS_SCHOOL;
}
