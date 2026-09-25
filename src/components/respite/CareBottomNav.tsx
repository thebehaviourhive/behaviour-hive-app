"use client";

import { AppBottomNav } from "@/components/ui/AppBottomNav";
import { CARE_NAV_TABS } from "./careNavTabs";

// Respite UI Stage 2b -- the shared AppBottomNav renderer, given the
// care_staff tab list. Same shape as CentreBottomNav.tsx.
export function CareBottomNav() {
  return (
    <div className="lg:hidden">
      <AppBottomNav tabs={CARE_NAV_TABS} />
    </div>
  );
}
