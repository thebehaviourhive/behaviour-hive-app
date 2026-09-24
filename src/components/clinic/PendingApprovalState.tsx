"use client";

import { LockIcon } from "@/components/ui/icons";

// PRD 10 Stage 3 correction, 21 Sept 2026 -- found live, twice, on the
// exact screens a genuinely joined-but-not-yet-approved clinic_admin
// and clinical_lead see: "Could not find your clinic" (the admin's own
// generic fallback) reads as broken, and "You're in" (the lead's own
// holding page, unconditionally, regardless of approval state) is
// actively FALSE for someone still awaiting their director. Both are
// the same failure this codebase already names elsewhere -- arriving
// at the front door to a screen that either looks broken or lies.
//
// The practitioner's own equivalent state (clinician/dashboard/page.tsx,
// gated on institutionJoinPending from useClinicianReviewState) already
// gets this right -- this is that same copy and shape, extracted so
// clinic_admin and clinical_lead share it rather than each drifting
// their own version. NOT reused for the clinician's own page itself --
// that page's gating logic (profile + institutionJoinPending, resolved
// through the clinicians table) is a different, working mechanism this
// change doesn't need to touch.
//
// waitingFor, PRD 11 Stage 2 -- found live, a third time, the exact
// same "Could not find your X" mistake this file's own header already
// names twice, now on /centre/dashboard for a pending second manager.
// Reused rather than forked a third copy -- only WHO the request is
// with differs (a centre manager, not a clinical director), so that's
// the one thing parametrized; defaults to the original wording so
// clinic_admin/clinical_lead's own two existing call sites need no
// change at all.
export function PendingApprovalState({ waitingFor = "clinical director" }: { waitingFor?: string }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 bg-brand-off-white/40 px-6 text-center">
      <span className="mb-1 flex h-20 w-20 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
        <LockIcon className="h-10 w-10" />
      </span>
      <h1 className="font-heading text-2xl font-bold text-brand-prussian-blue">You&apos;re not in yet</h1>
      <p className="max-w-[280px] text-sm text-brand-neutral-black/70">
        Your request is with your {waitingFor}. They&apos;ve been notified and can approve you from
        their own dashboard — there&apos;s nothing else for you to do. You&apos;ll get access the moment
        they confirm it.
      </p>
    </div>
  );
}
