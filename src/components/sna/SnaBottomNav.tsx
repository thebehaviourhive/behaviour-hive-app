"use client";

import { useEffect, useState } from "react";
import { House, Mail, Menu } from "lucide-react";
import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { useSupportButtonNavSlots } from "@/hooks/useSupportButtonNavSlots";
import { createClient } from "@/lib/supabase/client";

// SNA track's tab list -- 3 tabs. "Passports" owns the child list plus
// any individual child's scoped passport view; "Messages" owns
// /sna/messages (migration 0168, added here); "More" owns /more. There
// is still no separate Students-style roster page -- Passports home IS
// the roster.
//
// "Messages" here is STAFF-ONLY -- SNA-on-CHILD-threads is a separate,
// deliberately deferred piece (see CLAUDE.md's deferred-work entry;
// this was 0065's own original parked decision, not new scope this
// migration created). get_messages_awaiting_action_count() is already
// entirely role-blind (keyed on sender_id/recipient_id, no passport_id
// reference at all -- confirmed reading its body before relying on it
// here), so the badge count below correctly includes SNA's own staff
// threads with no change to that RPC.
export function SnaBottomNav() {
  // Self-contained, matching TeacherBottomNav's own established
  // convention -- the nav fetches its own userId/institutionId rather
  // than asking every call site to thread them through.
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
      .eq("role", "sna")
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
  const messagesAwaitingCount = useMessagesAwaitingActionCount(userId);
  const hasUnreadMessages = useHasUnreadMessages(userId);
  const { extraSlot, alertSlot } = useSupportButtonNavSlots({
    institutionId,
    userId,
    role: "sna",
  });

  const TABS: NavTab[] = [
    {
      key: "passports",
      label: "Passports",
      icon: House,
      href: "/sna/passports",
      isActive: (pathname) => pathname.startsWith("/sna/passport"),
    },
    {
      key: "messages",
      label: "Messages",
      icon: Mail,
      href: "/sna/messages",
      isActive: (pathname) => pathname.startsWith("/sna/messages"),
      badgeCount: messagesAwaitingCount,
      showUnreadDot: hasUnreadMessages,
    },
    {
      key: "more",
      label: "More",
      icon: Menu,
      href: "/more",
      isActive: (pathname) => pathname.startsWith("/more"),
    },
  ];

  return <AppBottomNav tabs={TABS} extraSlot={extraSlot} alertSlot={alertSlot} />;
}
