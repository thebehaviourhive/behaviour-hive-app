"use client";

import { useEffect, useState } from "react";
import { AppBottomNav } from "@/components/ui/AppBottomNav";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { createClient } from "@/lib/supabase/client";
import { CLINICIAN_NAV_TABS } from "./clinicianNavTabs";

// Clinician track's tab list. "Passports" owns the caseload list plus any
// individual case's clinical file; "Messages" owns the cross-caseload
// triage dashboard; "More" owns /more; everything else on this track
// (dashboard, its activity history, the Add Log flow, and the
// dashboard-launched resources) falls back to "Dashboard" as the
// default.
//
// Clinician desktop pass, Stage 1: the TABS list itself moved to
// clinicianNavTabs.ts, shared with the new ClinicianSidebar so the four
// destinations are defined in exactly one place -- same move PRD 4,
// Stage 1 made for the principal track. This component now also hides
// itself at lg+, where the sidebar (rendered once, from
// src/app/clinician/layout.tsx) takes over navigation -- the wrap lives
// here, not inside AppBottomNav itself, matching PrincipalBottomNav's
// own reasoning: AppBottomNav is shared with tracks that have no
// sidebar and must keep rendering this bar at every width, unchanged.
export function ClinicianBottomNav() {
  // Self-contained: see TeacherBottomNav's identical comment -- the nav
  // fetches its own userId rather than threading one through every call
  // site, and feeds the same RPC the dashboard stat already uses ("one
  // source, two surfaces").
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let isMounted = true;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (isMounted) setUserId(data.user?.id ?? null);
      });
    return () => {
      isMounted = false;
    };
  }, []);
  const messagesAwaitingCount = useMessagesAwaitingActionCount(userId);
  const hasUnreadMessages = useHasUnreadMessages(userId);
  const tabs = CLINICIAN_NAV_TABS.map((tab) =>
    tab.key === "messages" ? { ...tab, badgeCount: messagesAwaitingCount, showUnreadDot: hasUnreadMessages } : tab
  );

  return (
    <div className="lg:hidden">
      <AppBottomNav tabs={tabs} />
    </div>
  );
}
