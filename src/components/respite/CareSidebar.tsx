"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandMark";
import { useCurrentUserId } from "@/hooks/useCurrentUserId";
import { useHasUnreadMessages } from "@/hooks/useHasUnreadMessages";
import { CARE_NAV_TABS } from "./careNavTabs";

// Respite UI Stage 2b -- mirrors CentreSidebar.tsx's own structure
// exactly (same lg-only fixed rail, same active-pill styling), sized to
// care_staff's own two destinations rather than copying centre's four.
//
// Baseline audit, 26 Sept 2026 -- unread dot only, deliberately no
// numbered badge -- see CentreSidebar.tsx's own header for the full
// reasoning (the "awaiting action" count tracks acknowledged_at, which
// nothing in this track's own UI ever sets, so it could only ever grow).
export function CareSidebar() {
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
        {CARE_NAV_TABS.map((tab) => {
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
