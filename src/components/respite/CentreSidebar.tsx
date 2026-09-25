"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandMark";
import { CENTRE_NAV_TABS } from "./centreNavTabs";

// Mirrors PrincipalSidebar.tsx's own structure exactly -- same lg-only
// fixed rail, same active-pill styling -- deliberately without the two
// things that don't apply here: no Support Button (a respite centre
// never raises one, per 0296's own scoping of can_own_incident()/
// raise_support_alert() as untouched school RPCs), and no messages
// badge (no staff-to-staff messaging surface exists yet -- see
// centreNavTabs.ts's own header).
export function CentreSidebar() {
  const pathname = usePathname();

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
              <Icon aria-hidden size={20} strokeWidth={2} />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
