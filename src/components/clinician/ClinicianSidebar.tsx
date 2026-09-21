"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { BrandMark } from "@/components/ui/BrandMark";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { useDirectorSwitchBack } from "@/hooks/useClinicalWorkSwitch";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { CountBadge } from "@/components/ui/CountBadge";
import { CLINICIAN_NAV_TABS } from "./clinicianNavTabs";

// Clinician desktop pass, Stage 1 -- the second track to use this
// pattern, following PRD 4's principal precedent exactly: hidden below
// lg, additive, and nothing about AppBottomNav (shared with the other
// tracks) or its default maxWidthClassName changes because this file
// exists. Rendered once, from src/app/clinician/layout.tsx, so no
// individual clinician page needed to change to gain it.
//
// Simpler than PrincipalSidebar: no Support Button slot -- the
// clinician track never rendered one (ClinicianBottomNav has no
// alertSlot, no institutionId fetch, and useSupportButtonNavSlots is
// principal/class_teacher/sna-scoped only) -- so this component owns
// only its own userId fetch, for the Messages badge.
export function ClinicianSidebar() {
  const pathname = usePathname();

  // Self-contained, matching PrincipalSidebar/ClinicianBottomNav's own
  // pattern: fetches its own userId rather than threading one through
  // every call site.
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

  // Director/lead clinical-work switch, 21 Sept 2026 -- the reverse
  // direction. Shown only when the caller's own role is principal/
  // clinical_lead (never a plain practitioner). See
  // useClinicalWorkSwitch.ts's own header for the full reasoning.
  const directorSwitch = useDirectorSwitchBack();

  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-10 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-black/5 lg:bg-brand-off-white lg:px-4 lg:py-6">
      <div className="flex items-center gap-2 px-2 pb-6">
        <BrandMark size={28} />
        <span className="font-heading text-lg font-bold text-brand-prussian-blue">
          Behaviour Hive
        </span>
      </div>

      <nav className="flex flex-col gap-1">
        {CLINICIAN_NAV_TABS.map((tab) => {
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
              <span className="relative flex">
                <Icon aria-hidden size={20} strokeWidth={2} />
                {tab.key === "messages" && (
                  <>
                    <CountBadge count={messagesAwaitingCount} size="small" />
                    {hasUnreadMessages && (
                      <span
                        aria-label="New messages"
                        className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-brand-golden-brown shadow-sm"
                      />
                    )}
                  </>
                )}
              </span>
              {tab.label}
            </Link>
          );
        })}

        {directorSwitch.shouldShow && (
          <Link
            href={getPostAuthRedirect(directorSwitch.role)}
            className="mt-2 flex items-center gap-3 rounded-2xl border border-dashed border-black/10 px-3 py-2.5 font-sans text-body font-medium text-brand-neutral-black/70"
          >
            <ArrowLeftRight aria-hidden size={20} strokeWidth={2} />
            {directorSwitch.role === "clinical_lead" ? "Lead dashboard" : "Director dashboard"}
          </Link>
        )}
      </nav>
    </aside>
  );
}
