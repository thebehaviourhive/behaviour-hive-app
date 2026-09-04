"use client";

import { useEffect, useState } from "react";
import { AppBottomNav } from "@/components/ui/AppBottomNav";
import { useSupportButtonNavSlots } from "@/hooks/useSupportButtonNavSlots";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { createClient } from "@/lib/supabase/client";
import { PRINCIPAL_NAV_TABS } from "./principalNavTabs";

// PRD 2, Stage 1. Matches TeacherBottomNav/ClinicianBottomNav/
// SnaBottomNav's own established shape exactly -- a thin per-track
// TABS list rendered through the one shared AppBottomNav renderer, not
// a new nav implementation. No message-badge complexity (no Messages
// tab on this track), so unlike the other three, this one needs no own
// userId fetch at all -- genuinely simpler, not a shortcut.
//
// "Directory" owns Staff, Classes, Passports, and (Stage 6) Temporary
// Access -- still-separate routes (Stages 2/3/5/6 reconcile their own
// content; this stage only gives them a shared destination and a
// shared active-tab state).
// "School" owns the new /principal/school landing (account
// administration, settings) that this same stage introduces.
//
// PRD 4, Stage 1: the TABS list itself moved to principalNavTabs.ts,
// shared with the new PrincipalSidebar so the four destinations are
// defined in exactly one place. This component now also hides itself
// at lg+, where the sidebar (rendered once, from
// src/app/principal/layout.tsx) takes over navigation -- the wrap
// lives here, not inside AppBottomNav itself, since AppBottomNav is
// shared with four tracks that have no sidebar and must keep rendering
// this bar at every width, unchanged.
export function PrincipalBottomNav() {
  // Support Button needs a userId/institutionId this component never
  // fetched before (its own header comment used to say so, genuinely --
  // no longer true now that this exists). role: null -- a principal
  // cannot raise (raise_support_alert()'s own role check is class_
  // teacher/sna only); they can only view and acknowledge, matching
  // useSupportButtonNavSlots' own handling of a null role.
  const [userId, setUserId] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
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
  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    createClient()
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", userId)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle()
      .then(({ data }) => {
        if (isMounted) setInstitutionId(data?.institution_id ?? null);
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);
  const { alertSlot } = useSupportButtonNavSlots({ institutionId, userId, role: null });

  // Migration 0161 -- same shared hook TeacherBottomNav/ClinicianBottomNav
  // already use for their own Messages badge, "entirely self-scoped
  // server-side (auth.uid()), nothing role-specific needed" per its own
  // comment -- confirmed true for a principal too, no RPC change required
  // for this specific count.
  const messagesAwaitingCount = useMessagesAwaitingActionCount(userId);
  const hasUnreadMessages = useHasUnreadMessages(userId);
  const tabs = PRINCIPAL_NAV_TABS.map((tab) =>
    tab.key === "messages" ? { ...tab, badgeCount: messagesAwaitingCount, showUnreadDot: hasUnreadMessages } : tab
  );

  // Widened past AppBottomNav's own max-w-sm default -- measured live at
  // 1280px (Stage 1's own review): the shared default left the four tabs
  // clustered in a 384px strip centred inside a full-width white bar,
  // real dead space either side, on the laptop/iPad width principals
  // mostly use this on. Opt-in only (maxWidthClassName), the other four
  // tracks' own nav is untouched. Moot at lg+ now that this bar hides
  // there entirely, but left as-is for the md-and-below range where it
  // still applies.
  return (
    <div className="lg:hidden">
      <AppBottomNav tabs={tabs} maxWidthClassName="max-w-2xl" alertSlot={alertSlot} />
    </div>
  );
}
