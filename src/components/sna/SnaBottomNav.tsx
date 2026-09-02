"use client";

import { useEffect, useState } from "react";
import { House, Menu } from "lucide-react";
import { AppBottomNav, type NavTab } from "@/components/ui/AppBottomNav";
import { useSupportButtonNavSlots } from "@/hooks/useSupportButtonNavSlots";
import { createClient } from "@/lib/supabase/client";

// SNA track's tab list -- deliberately just 2 tabs, per the brief.
// "Passports" owns the child list plus any individual child's scoped
// passport view; "More" owns /more. There is no Messages tab (Messages
// is fully excluded for SNA in v1 -- see migration 0065 §11) and no
// separate Students-style roster page -- Passports home IS the roster.
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
      key: "more",
      label: "More",
      icon: Menu,
      href: "/more",
      isActive: (pathname) => pathname.startsWith("/more"),
    },
  ];

  return <AppBottomNav tabs={TABS} extraSlot={extraSlot} alertSlot={alertSlot} />;
}
