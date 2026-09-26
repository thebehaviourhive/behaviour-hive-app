"use client";

import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { CARE_NAV_TABS } from "./careNavTabs";

// Respite UI Stage 2b -- the shared AppBottomNav renderer, given the
// care_staff tab list. Same shape as CentreBottomNav.tsx.
//
// Baseline audit, 26 Sept 2026 -- unread dot only, deliberately no
// badgeCount -- see CentreSidebar.tsx's own header for the full
// reasoning.
export function CareBottomNav() {
  const userId = useCurrentUserId();
  const hasUnreadMessages = useHasUnreadMessages(userId);
  const tabs: NavTab[] = CARE_NAV_TABS.map((tab) =>
    tab.key === "messages" ? { ...tab, showUnreadDot: hasUnreadMessages } : tab
  );

  return (
    <div className="lg:hidden">
      <AppBottomNav tabs={tabs} />
    </div>
  );
}
