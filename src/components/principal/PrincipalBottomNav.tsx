"use client";

import { AppBottomNav } from "@/components/ui/AppBottomNav";
import { PRINCIPAL_NAV_TABS } from "./principalNavTabs";

// PRD 2, Stage 1. Matches TeacherBottomNav/ClinicianBottomNav/
// SnaBottomNav's own established shape exactly -- a thin per-track
// TABS list rendered through the one shared AppBottomNav renderer, not
// a new nav implementation. No message-badge complexity (no Messages
// tab on this track), so unlike the other three, this one needs no own
// userId fetch at all -- genuinely simpler, not a shortcut.
//
// "Directory" owns Staff, Classes, Passports, and (Stage 6) Temporary
// Access -- still-separate routes (Stages 2/3/5/6 reconcile their own
// content; this stage only gives them a shared destination and a
// shared active-tab state).
// "School" owns the new /principal/school landing (account
// administration, settings) that this same stage introduces.
//
// PRD 4, Stage 1: the TABS list itself moved to principalNavTabs.ts,
// shared with the new PrincipalSidebar so the four destinations are
// defined in exactly one place. This component now also hides itself
// at lg+, where the sidebar (rendered once, from
// src/app/principal/layout.tsx) takes over navigation -- the wrap
// lives here, not inside AppBottomNav itself, since AppBottomNav is
// shared with four tracks that have no sidebar and must keep rendering
// this bar at every width, unchanged.
export function PrincipalBottomNav() {
  // Widened past AppBottomNav's own max-w-sm default -- measured live at
  // 1280px (Stage 1's own review): the shared default left the four tabs
  // clustered in a 384px strip centred inside a full-width white bar,
  // real dead space either side, on the laptop/iPad width principals
  // mostly use this on. Opt-in only (maxWidthClassName), the other four
  // tracks' own nav is untouched. Moot at lg+ now that this bar hides
  // there entirely, but left as-is for the md-and-below range where it
  // still applies.
  return (
    <div className="lg:hidden">
      <AppBottomNav tabs={PRINCIPAL_NAV_TABS} maxWidthClassName="max-w-2xl" />
    </div>
  );
}
