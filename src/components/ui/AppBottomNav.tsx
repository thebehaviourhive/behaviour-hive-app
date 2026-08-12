"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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
export function AppBottomNav({ tabs, extraSlot }: { tabs: NavTab[]; extraSlot?: ReactNode }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-black/5 bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-sm items-center justify-around px-2 py-1.5">
        {tabs.map((tab) => {
          const isActive = tab.isActive(pathname);
          const Icon = tab.icon;

          const content = (
            <span
              className={`flex flex-col items-center gap-0.5 rounded-2xl px-3.5 py-1.5 transition-colors duration-150 ${
                isActive ? "bg-brand-pastel-blue" : ""
              }`}
            >
              <Icon
                aria-hidden
                size={24}
                strokeWidth={2}
                className={isActive ? "text-brand-prussian-blue" : "text-brand-neutral-black/40"}
              />
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
