"use client";

import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { CARE_NAV_TABS } from "./careNavTabs";

// Respite UI Stage 2b -- the shared AppBottomNav renderer, given the
// care_staff tab list. Same shape as CentreBottomNav.tsx.
//
// Baseline audit, 26 Sept 2026 -- Messages badge/dot added, same shape
// as CentreBottomNav's own.
export function CareBottomNav() {
  const userId = useCurrentUserId();
  const messagesAwaitingCount = useMessagesAwaitingActionCount(userId);
  const hasUnreadMessages = useHasUnreadMessages(userId);
  const tabs: NavTab[] = CARE_NAV_TABS.map((tab) =>
    tab.key === "messages" ? { ...tab, badgeCount: messagesAwaitingCount, showUnreadDot: hasUnreadMessages } : tab
  );

  return (
    <div className="lg:hidden">
      <AppBottomNav tabs={tabs} />
    </div>
  );
}
