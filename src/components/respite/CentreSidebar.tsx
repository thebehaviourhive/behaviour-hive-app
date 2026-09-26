"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandMark";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { CENTRE_NAV_TABS } from "./centreNavTabs";

// Mirrors PrincipalSidebar.tsx's own structure exactly -- same lg-only
// fixed rail, same active-pill styling -- deliberately without the one
// thing that still doesn't apply here: no Support Button (a respite
// centre never raises one, per 0296's own scoping of can_own_incident()/
// raise_support_alert() as untouched school RPCs).
//
// Baseline audit, 26 Sept 2026 -- the Messages badge/dot this file's
// own header used to say didn't apply ("no staff-to-staff messaging
// surface exists yet") was written before Respite UI Stage 2b shipped
// get_my_handover_messages() and this same file's own Messages tab.
//
// DOT ONLY, deliberately NOT the numbered CountBadge principal/teacher/
// clinician/sna carry -- Daniel's own correction, 26 Sept 2026. That
// count (useMessagesAwaitingActionCount, get_messages_awaiting_action_
// count()) tracks message_recipients.acknowledged_at, and nothing in
// the respite track ever calls acknowledge_message() -- HandoverInboxSection/
// HandoverDetailSheet only ever call mark_message_read(), which sets
// read_at, a genuinely separate column (0170's own header: "seen it"
// vs "dealt with it"). Every handover a centre_manager/care_staff
// receives would count toward that badge forever, with literally no
// action in this track's own UI that could ever clear it -- confirmed
// live during the baseline audit (a real careA session with 2 unread
// handovers showed "2 awaiting your action", and there is no
// Acknowledge control anywhere in HandoverDetailSheet to make that
// number ever go back down). A badge that never clears is worse than
// no badge -- it trains people to stop trusting every badge in the
// app, not just this one. useHasUnreadMessages (read_at is null) has
// no such problem: reading a handover via HandoverInboxSection's own
// onOpenMessage already calls markRead, so the dot clears correctly,
// same as it always has. Only this track's own badge is affected --
// useMessagesAwaitingActionCount stays exactly as it is everywhere
// else (principal, teacher, clinician, sna), and no message semantics
// changed.
export function CentreSidebar() {
  const pathname = usePathname();
  const userId = useCurrentUserId();
  const hasUnreadMessages = useHasUnreadMessages(userId);

  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-10 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-black/5 lg:bg-brand-off-white lg:px-4 lg:py-6">
      <div className="flex items-center gap-2 px-2 pb-6">
        <BrandMark size={28} />
        <span className="font-heading text-lg font-bold text-brand-prussian-blue">Behaviour Hive</span>
      </div>

      <nav className="flex flex-col gap-1">
        {CENTRE_NAV_TABS.map((tab) => {
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
                {tab.key === "messages" && hasUnreadMessages && (
                  <span
                    aria-label="New messages"
                    className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-brand-golden-brown shadow-sm"
                  />
                )}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
