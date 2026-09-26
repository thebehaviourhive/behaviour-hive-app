"use client";

import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { CENTRE_NAV_TABS } from "./centreNavTabs";

// The shared AppBottomNav renderer, given the centre tab list -- same
// shape as PrincipalBottomNav.tsx, minus the Support Button alert
// plumbing that file carries (no Support Button here -- see
// CentreSidebar.tsx's own header for why). lg:hidden, matching every
// other bottom-nav caller in this app.
//
// Baseline audit, 26 Sept 2026 -- unread dot only, deliberately no
// badgeCount -- see CentreSidebar.tsx's own header for the full
// reasoning (the "awaiting action" count tracks acknowledged_at, which
// nothing in this track's own UI ever sets, so the number could only
// ever grow).
export function CentreBottomNav() {
  const userId = useCurrentUserId();
  const hasUnreadMessages = useHasUnreadMessages(userId);
  const tabs: NavTab[] = CENTRE_NAV_TABS.map((tab) =>
    tab.key === "messages" ? { ...tab, showUnreadDot: hasUnreadMessages } : tab
  );

  return (
    <div className="lg:hidden">
      <AppBottomNav tabs={tabs} />
    </div>
  );
}
