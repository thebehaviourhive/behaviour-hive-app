"use client";

import { useEffect, useState } from "react";
import { House, FolderOpen, Mail, Menu } from "lucide-react";
import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { createClient } from "@/lib/supabase/client";

// Clinician track's tab list. "Passports" owns the caseload list plus any
// individual case's clinical file; "Messages" owns the cross-caseload
// triage dashboard; "More" owns /more; everything else on this track
// (dashboard, its activity history, the Add Log flow, and the
// dashboard-launched resources) falls back to "Dashboard" as the
// default.
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

  const TABS: NavTab[] = [
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
    {
      key: "messages",
      label: "Messages",
      icon: Mail,
      href: "/clinician/messages",
      isActive: (pathname) => pathname.startsWith("/clinician/messages"),
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

  return <AppBottomNav tabs={TABS} />;
}
