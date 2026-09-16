"use client";

import { useEffect, useState } from "react";
import { House, BookUser, Menu } from "lucide-react";
import { AppBottomNav, type NavTab } from "./AppBottomNav";
import { CalmNavButton } from "@/components/parent/calm/CalmNavButton";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { createClient } from "@/lib/supabase/client";

// Parent track's tab list. "Passport" owns every /passport/* route (the
// section wizard as well as the dashboard); "More" owns /more; everything
// else on this track (dashboard, its activity history, and the
// dashboard-launched resources/messages/morning-checkin destinations)
// falls back to "Home" as the default.
//
// `passportHref` is an OPTIONAL precision override, not a requirement --
// a caller that has already done the (multi-table) work to know exactly
// which onboarding step to resume at (parent-dashboard) can pass that
// exact href so the tap skips a redirect hop. Any caller that hasn't
// (or, like /more, has no reason to ever fetch passport-progress data at
// all) gets "/passport/dashboard" by default: a stable, always-valid
// destination that /passport/dashboard's own page already redirects
// onward from if the passport isn't actually complete yet (see its
// `resumeHref` redirect). Root-causing this here, once, means no future
// page that renders <BottomNav> can reproduce a dead Passport tab by
// simply forgetting to wire this prop.
export function BottomNav({ passportHref = "/passport/dashboard" }: { passportHref?: string }) {
  // Stage 5, item 6: a parent's own Messages entry point is the
  // dashboard's own quick-action tile, below the fold on mobile -- there
  // was no way to know a message had arrived without scrolling to it.
  // Same "the nav fetches its own userId" convention TeacherBottomNav/
  // SnaBottomNav/ClinicianBottomNav/PrincipalBottomNav already establish,
  // rather than threading it through every page that renders this nav.
  // useHasUnreadMessages is already role-generic (recipient_id = userId,
  // RLS does the scoping) -- no changes needed to reuse it here.
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
  const hasUnreadMessages = useHasUnreadMessages(userId);

  const tabs: NavTab[] = [
    {
      key: "home",
      label: "Home",
      icon: House,
      href: "/parent-dashboard",
      isActive: (pathname) => !pathname.startsWith("/passport") && !pathname.startsWith("/more"),
      // The parent track has no dedicated Messages tab (unlike teacher/
      // SNA/clinician/principal) -- messages are reached via the
      // dashboard's own quick-action tile, so the dot lives on Home, the
      // one tab that's always visible without scrolling, matching every
      // other track's own "opposite corner from the numbered badge" dot.
      showUnreadDot: hasUnreadMessages,
    },
    {
      key: "passport",
      label: "Passport",
      icon: BookUser,
      href: passportHref,
      isActive: (pathname) => pathname.startsWith("/passport"),
    },
    {
      key: "more",
      label: "More",
      icon: Menu,
      href: "/more",
      isActive: (pathname) => pathname.startsWith("/more"),
    },
  ];

  return <AppBottomNav tabs={tabs} extraSlot={<CalmNavButton />} />;
}
