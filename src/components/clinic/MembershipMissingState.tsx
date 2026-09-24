"use client";

import { AlertTriangleIcon } from "@/components/ui/icons";

// The sibling to PendingApprovalState.tsx: the "missing" outcome of
// useInstitutionMembership.ts -- a deactivated, rejected, or genuinely
// absent institution_staff row, as distinct from a pending one. Built
// alongside that hook, closing the pending-vs-missing misdiagnosis as a
// class rather than leaving each dashboard to invent its own error copy
// (each of the four original dashboards had a different one: an inline
// <p> beside a still-visible header, a full-screen centred block, or --
// on clinical_lead -- no missing-state UI at all, see the hook's own
// header). Every dashboard built on the hook renders this for `status
// === "missing"`, nothing else.
//
// Deliberately not the Support Button's reserved red (this codebase's
// own standing rule) -- this is "we couldn't find your account," not an
// emergency, and reads as a genuine but calm problem the way
// PendingApprovalState reads as a genuine but calm wait.
export function MembershipMissingState({ noun }: { noun: string }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 bg-brand-off-white/40 px-6 text-center">
      <span className="mb-1 flex h-20 w-20 items-center justify-center rounded-full bg-brand-golden-brown/20 text-brand-golden-brown">
        <AlertTriangleIcon className="h-10 w-10" />
      </span>
      <h1 className="font-heading text-2xl font-bold text-brand-prussian-blue">Could not find your {noun}</h1>
      <p className="max-w-[280px] text-sm text-brand-neutral-black/70">
        We couldn&apos;t find an active account for you here. If you think this is wrong, contact
        whoever manages your organisation&apos;s account.
      </p>
    </div>
  );
}
