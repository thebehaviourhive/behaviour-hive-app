"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandMark";
import { useSupportButtonNavSlots } from "@/hooks/useSupportButtonNavSlots";
import { createClient } from "@/lib/supabase/client";
import { PRINCIPAL_NAV_TABS } from "./principalNavTabs";

// PRD 4, Stage 1 -- the principal track's first responsive breakpoint,
// and this app's first anywhere: recon for this stage found zero
// lg:/md: variants used in the whole codebase before this file.
// Principal-only and additive -- hidden below lg, and nothing about
// AppBottomNav (shared with four other tracks) or its default
// maxWidthClassName changes because this file exists. Rendered once,
// from src/app/principal/layout.tsx, so no individual principal page
// needed to change to gain it.
//
// No live school name yet. The PRD's spec puts one at the top of the
// sidebar, but Stage 1 is scoped to touch no data (PRD 4 standing
// rule) -- the existing institution-name lookup lives inside
// Dashboard's own large data-loading effect, entangled with its
// ROLE_MISMATCH handling and the institution_id every other dashboard
// query depends on, and isn't safely extractable into a shared read
// without risking that screen's own behaviour. BrandMark stands in for
// now; a school-name header is a candidate for whichever later stage
// first has a legitimate, independent reason to fetch it.
export function PrincipalSidebar() {
  const pathname = usePathname();

  // Support Button -- a SEPARATE renderer from PrincipalBottomNav, not
  // the same component CSS-hidden. Both are mounted unconditionally at
  // every width already (this file's own header comment), so the alert
  // block below and the bottom nav's own alertSlot are kept in sync by
  // sharing the same poll (useSupportAlertStatus, via this same hook),
  // not by being one component -- if this ever needs changing, both
  // call sites need the change, not just one.
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

  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-10 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-black/5 lg:bg-brand-off-white lg:px-4 lg:py-6">
      <div className="flex items-center gap-2 px-2 pb-6">
        <BrandMark size={28} />
        <span className="font-heading text-lg font-bold text-brand-prussian-blue">
          Behaviour Hive
        </span>
      </div>

      {alertSlot && <div className="mb-4 rounded-2xl bg-brand-support-red px-3 py-2.5">{alertSlot}</div>}

      <nav className="flex flex-col gap-1">
        {PRINCIPAL_NAV_TABS.map((tab) => {
          const isActive = tab.isActive(pathname);
          const Icon = tab.icon;

          if (!tab.href) return null;

          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 font-sans text-body transition-colors ${
                isActive
                  ? "bg-brand-pastel-blue font-semibold text-brand-prussian-blue"
                  : "font-medium text-brand-neutral-black/70"
              }`}
            >
              <Icon aria-hidden size={20} strokeWidth={2} />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
