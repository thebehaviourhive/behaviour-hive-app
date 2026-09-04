"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CountBadge } from "./CountBadge";

export interface NavTab {
  key: string;
  label: string;
  icon: LucideIcon;
  // Undefined when the destination can't be determined yet (e.g. the
  // parent's passport-resume target on a page that hasn't loaded that
  // state) -- the tab still renders, but as a non-interactive element
  // rather than a link, matching the existing fallback behaviour.
  href: string | undefined;
  isActive: (pathname: string) => boolean;
  // The Messages waiting-count badge (teacher + clinician tracks only,
  // see NAV + HEADER refinements) -- same source, same rules as the
  // dashboard stat: Prussian Blue, absent at 0, never red. Omit for tabs
  // that never carry one.
  badgeCount?: number | null;
  // migration 0170 -- a separate "something new" signal, deliberately
  // not folded into badgeCount. "Awaiting your action" (the number) and
  // "unread" (this dot) answer different questions and can both be true
  // at once -- a message can be read and still awaiting your reply.
  // Golden Brown, positioned at the opposite corner from the numbered
  // badge so the two never collide when both are present.
  showUnreadDot?: boolean;
}

// The single shared bottom-nav renderer for all three tracks (parent,
// teacher, clinician). Each track supplies its own list of tabs (icon,
// label, href, and a route-ownership matcher); this component owns all of
// the shared visual and active-state logic, so a styling or behaviour fix
// only ever needs to happen here.
// extraSlot: an optional non-tab item appended to the same flex row --
// the parent track's Calm button (Stage 2A) is the one caller today.
// Deliberately NOT a NavTab: it's "an action, not a destination" (never
// takes the active-page pill state the way Home/Passport/More do, and
// its live/locked tap behaviour differs per state -- navigate vs open a
// sheet), so it doesn't fit NavTab's Link+isActive model and gets its
// own render slot instead of being shoehorned into the tabs array.
//
// alertSlot: the Support Button's own transformed-bar state. Same
// "optional, opt-in, additive" shape as maxWidthClassName below -- one
// more prop, not a fork. THE BAR CARRIES BOTH (Daniel's own call,
// correcting an earlier instinct to have the alert replace the tabs
// until acknowledged): the raiser has no one-tap resolve, only Close,
// and forcing them to end the whole event just to walk to another room
// would be exactly the trap this design avoids. So when alertSlot is
// present, a red strip renders ABOVE the ordinary tab row, and the tab
// row itself is completely unchanged -- own white background, own
// existing colours -- rather than recolouring every tab state to work
// against a red backdrop. Navigation always still works underneath.
export function AppBottomNav({
  tabs,
  extraSlot,
  alertSlot,
  maxWidthClassName = "max-w-sm",
}: {
  tabs: NavTab[];
  extraSlot?: ReactNode;
  alertSlot?: ReactNode;
  // PRD 2, Stage 2: an optional override, defaulting to the original
  // max-w-sm every existing caller (BottomNav/TeacherBottomNav/
  // SnaBottomNav/ClinicianBottomNav) keeps unchanged -- widening the
  // principal track's own nav on a laptop/iPad (parked as "wrong on a
  // wide screen" during Stage 1's own review) without touching this
  // component's default for the other four tracks, which have no reason
  // to be destabilised by a principal-only layout decision. One
  // component, one behaviour change gated on an opt-in prop -- not a
  // fork.
  maxWidthClassName?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-black/5 bg-white pb-[env(safe-area-inset-bottom)]">
      {/* The alert strip deliberately does NOT take maxWidthClassName --
          that constraint exists to keep the tab ROW's icons visually
          centred at a comfortable width, not to cap an alert message's
          own text. Found live: at maxWidthClassName's default (max-w-sm,
          384px) a raiser's name plus a room name genuinely didn't fit
          and got cut off mid-word behind an ellipsis on a 1280px screen
          with room to spare. Full width instead. */}
      {alertSlot && (
        <div className="border-b border-white/20 bg-brand-support-red px-4 py-2.5">{alertSlot}</div>
      )}
      <div className={`mx-auto flex ${maxWidthClassName} items-center justify-around px-2 py-1.5`}>
        {tabs.map((tab) => {
          const isActive = tab.isActive(pathname);
          const Icon = tab.icon;

          const content = (
            <span
              className={`flex flex-col items-center gap-0.5 rounded-2xl px-3.5 py-1.5 transition-colors duration-150 ${
                isActive ? "bg-brand-pastel-blue" : ""
              }`}
            >
              <span className="relative flex">
                <Icon
                  aria-hidden
                  size={24}
                  strokeWidth={2}
                  className={isActive ? "text-brand-prussian-blue" : "text-brand-neutral-black/40"}
                />
                <CountBadge count={tab.badgeCount} size="small" />
                {tab.showUnreadDot && (
                  <span
                    aria-label="New messages"
                    className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-brand-golden-brown shadow-sm"
                  />
                )}
              </span>
              <span
                className={`font-sans text-[10px] leading-none ${
                  isActive
                    ? "font-semibold text-brand-prussian-blue"
                    : "font-medium text-brand-neutral-black/40"
                }`}
              >
                {tab.label}
              </span>
            </span>
          );

          if (!tab.href) {
            return (
              <div key={tab.key} className="flex min-h-[44px] flex-1 items-center justify-center">
                {content}
              </div>
            );
          }

          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className="flex min-h-[44px] flex-1 items-center justify-center"
            >
              {content}
            </Link>
          );
        })}
        {extraSlot}
      </div>
    </nav>
  );
}
