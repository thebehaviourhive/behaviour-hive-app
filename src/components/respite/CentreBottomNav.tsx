"use client";

import { AppBottomNav } from "@/components/ui/AppBottomNav";
import { CENTRE_NAV_TABS } from "./centreNavTabs";

// The shared AppBottomNav renderer, given the centre tab list -- same
// shape as PrincipalBottomNav.tsx, minus the badge/alert plumbing that
// file carries (no messages badge, no Support Button alert -- see
// CentreSidebar.tsx's own header for why). lg:hidden, matching every
// other bottom-nav caller in this app.
export function CentreBottomNav() {
  return (
    <div className="lg:hidden">
      <AppBottomNav tabs={CENTRE_NAV_TABS} />
    </div>
  );
}
