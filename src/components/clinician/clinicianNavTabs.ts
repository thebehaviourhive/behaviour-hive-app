import { House, FolderOpen, Mail, Menu } from "lucide-react";
import type { NavTab } from "@/components/ui/AppBottomNav";

// Clinician desktop pass, Stage 1 -- same move as principalNavTabs.ts
// (PRD 4, Stage 1): the one place the clinician track's four top-level
// destinations are defined, so ClinicianBottomNav (375px) and the new
// ClinicianSidebar (1280px, this stage) both import this instead of
// each hardcoding their own copy of the same four hrefs and isActive
// matchers. Lifted verbatim from ClinicianBottomNav's own pre-existing
// TABS array -- content and matchers unchanged, not altered or added
// to. See that component's own header comment for what each
// destination owns ("Passports" owns the caseload list plus any
// individual case's clinical file; "Messages" owns the cross-caseload
// triage dashboard; "More" owns /more; everything else on this track
// falls back to "Dashboard" as the default).
export const CLINICIAN_NAV_TABS: NavTab[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: House,
    href: "/clinician/dashboard",
    isActive: (pathname) =>
      pathname.startsWith("/clinician") &&
      !pathname.startsWith("/clinician/passports") &&
      !pathname.startsWith("/clinician/passport/") &&
      !pathname.startsWith("/clinician/messages"),
  },
  {
    key: "passports",
    label: "Passports",
    icon: FolderOpen,
    href: "/clinician/passports",
    isActive: (pathname) =>
      pathname.startsWith("/clinician/passports") || pathname.startsWith("/clinician/passport/"),
  },
  // badgeCount/showUnreadDot are injected by each consumer
  // (ClinicianBottomNav/ClinicianSidebar), same as every field on this
  // base array that varies per render -- this file only owns the
  // destinations themselves, matching principalNavTabs.ts's own
  // convention.
  {
    key: "messages",
    label: "Messages",
    icon: Mail,
    href: "/clinician/messages",
    isActive: (pathname) => pathname.startsWith("/clinician/messages"),
  },
  {
    key: "more",
    label: "More",
    icon: Menu,
    href: "/more",
    isActive: (pathname) => pathname.startsWith("/more"),
  },
];
