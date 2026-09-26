"use client";

import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { CENTRE_NAV_TABS } from "./centreNavTabs";

// The shared AppBottomNav renderer, given the centre tab list -- same
// shape as PrincipalBottomNav.tsx, minus the Support Button alert
// plumbing that file carries (no Support Button here -- see
// CentreSidebar.tsx's own header for why). lg:hidden, matching every
// other bottom-nav caller in this app.
//
// Baseline audit, 26 Sept 2026 -- Messages badge/dot added, same
// tab-mapping shape PrincipalBottomNav already uses for its own.
export function CentreBottomNav() {
  const userId = useCurrentUserId();
  const messagesAwaitingCount = useMessagesAwaitingActionCount(userId);
  const hasUnreadMessages = useHasUnreadMessages(userId);
  const tabs: NavTab[] = CENTRE_NAV_TABS.map((tab) =>
    tab.key === "messages" ? { ...tab, badgeCount: messagesAwaitingCount, showUnreadDot: hasUnreadMessages } : tab
  );

  return (
    <div className="lg:hidden">
      <AppBottomNav tabs={tabs} />
    </div>
  );
}
