"use client";

import { useEffect, useState } from "react";
import { House, Users, Mail, Menu } from "lucide-react";
import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { useSupportButtonNavSlots } from "@/hooks/useSupportButtonNavSlots";
import { createClient } from "@/lib/supabase/client";

// Teacher track's tab list. "Students" owns the roster plus any
// per-student view reached from it (a student's classroom profile and the
// end-of-day wizard); "Messages" owns the triage view; "More" owns
// /more; everything else on this track (dashboard, its activity history,
// the morning grid, ABC log, and the dashboard-launched resources) falls
// back to "Dashboard" as the default.
export function TeacherBottomNav() {
  // Self-contained: the nav renders on every teacher page, so it fetches
  // its own userId rather than asking every call site to thread one
  // through. Deliberately NOT useRequireRole -- that hook's redirect
  // logic belongs to the page, not a nav bar mounted underneath it; this
  // is just enough to feed the same RPC the dashboard stat already uses
  // ("one source, two surfaces").
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
  // Support Button needs the teacher's own institution, same as
  // userId above -- fetched here rather than threaded through every
  // page that renders this nav, matching the "nav fetches its own"
  // convention this component already establishes.
  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    createClient()
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", userId)
      .eq("role", "class_teacher")
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
  const { extraSlot, alertSlot } = useSupportButtonNavSlots({
    institutionId,
    userId,
    role: "class_teacher",
  });

  const TABS: NavTab[] = [
    {
      key: "dashboard",
      label: "Dashboard",
      icon: House,
      href: "/teacher/dashboard",
      isActive: (pathname) =>
        pathname.startsWith("/teacher") &&
        !pathname.startsWith("/teacher/students") &&
        !pathname.startsWith("/teacher/passport/") &&
        !pathname.startsWith("/teacher/eod/") &&
        !pathname.startsWith("/teacher/messages"),
    },
    {
      key: "students",
      label: "Students",
      icon: Users,
      href: "/teacher/students",
      isActive: (pathname) =>
        pathname.startsWith("/teacher/students") ||
        pathname.startsWith("/teacher/passport/") ||
        pathname.startsWith("/teacher/eod/"),
    },
    {
      key: "messages",
      label: "Messages",
      icon: Mail,
      href: "/teacher/messages",
      isActive: (pathname) => pathname.startsWith("/teacher/messages"),
      badgeCount: messagesAwaitingCount,
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
