"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LockIcon, ClinicalFileIcon } from "@/components/ui/icons";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ClinicianComingSoonPage } from "@/components/clinician/ClinicianComingSoonPage";
import type { ClinicianReviewProfile, ClinicianReviewState } from "@/hooks/useClinicianReviewState";

// QA run-through, item 4: an unverified clinician could reach every tab
// except the dashboard -- the dashboard alone showed a locked state
// (not_submitted / pending_review / rejected), every other page (log,
// insights, messages, fba, passports, activity) rendered its real,
// functional-looking UI, just against real data that RLS already
// empties out for them (is_verified_clinician() gates clinician_access
// reads throughout the app -- confirmed, this was never a live data
// leak). The gap was access-consistency, not a security hole: a
// pending clinician should see the SAME "you're not in yet" message
// everywhere, not a page that looks like it works and shows nothing.
//
// This wraps a page's real content: renders the identical lock card
// language the dashboard already established (same copy, same
// LockIcon, same "Coming Soon" treatment for a non-behavioural-
// psychologist specialty) in place of `children` until reviewState is
// "verified" -- a hard replace, not dashboard's own blur-behind-real-
// content overlay (which still fetches and renders everything real
// underneath). Deliberately NOT used on /clinician/verify or /clinician/
// specialty -- those two ARE the path to getting verified, and must
// stay reachable before it.
export function ClinicianAccessGate({
  isLoading,
  profile,
  reviewState,
  institutionJoinPending = false,
  error,
  onRetry,
  children,
}: {
  isLoading: boolean;
  profile: ClinicianReviewProfile | null;
  reviewState: ClinicianReviewState | null;
  // See useClinicianReviewState.ts's own doc comment on this field.
  // Optional (defaults false) so every existing call site keeps
  // compiling; the real fix is passing it through from the hook.
  institutionJoinPending?: boolean;
  error: string | null;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (isLoading) return null;

  if (error) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-brand-off-white/40 px-4 text-center">
        <InlineErrorState message={error} onRetry={onRetry} />
      </div>
    );
  }

  // Joined a clinic by code, no director approval yet -- found live,
  // 21 Sept 2026, building the clinic role picker's own real-signup
  // proof: this used to fall into the branch below and tell someone
  // who joined by code to go pick a specialty, the INDEPENDENT path's
  // own next step, actively wrong for this person. Checked first,
  // before the generic no-profile fallback -- a clinic join in
  // progress is a more specific fact than "no clinicians row exists".
  if (!profile && institutionJoinPending) {
    return (
      <LockedCard message="Your request is with your clinical director. They've been notified and can approve you from their own dashboard -- there's nothing else for you to do. You'll get access the moment they confirm it." />
    );
  }

  // No clinicians row at all, and no clinic join pending either --
  // hasn't even reached specialty selection yet (the independent
  // path's own first step). Not normally reachable once role-select
  // has run, but a locked fallback rather than silently rendering the
  // real page either way.
  if (!profile || reviewState === null) {
    return (
      <LockedCard
        message="Select your clinical specialty to get started."
        href="/clinician/specialty"
        linkLabel="Get Started"
      />
    );
  }

  // This "not supported yet" branch only ever meant anything for the
  // INDEPENDENT, behaviour_hive-reviewed path -- behavioural_psychologist
  // was the one specialty that verification form actually supported.
  // Organisation-verified practitioners (0222, PRD 5 Stage 6) never go
  // through that form at all -- their director's own approval IS their
  // verification, the same zero-extra-review precedent class_teacher/
  // SNA already have, and their specialty starts at 'unspecified' by
  // design, a genuine placeholder, not something anyone is ever asked to
  // pick before being let in. Gating them here on specialty is the exact
  // same credential-style theatre Stage 6 already decided doesn't apply
  // to them -- a real, live bug found live: every organisation-verified
  // practitioner was locked out of the ENTIRE clinician track (dashboard,
  // caseload, messages, everything ClinicianAccessGate wraps), not just
  // this one screen, because nothing here was ever updated for the
  // second verification route Stage 6 introduced.
  if (profile.verificationRoute !== "organisation" && profile.specialty !== "behavioural_psychologist") {
    return (
      <ClinicianComingSoonPage
        Icon={ClinicalFileIcon}
        body="Verification for this clinical role is currently in development. We are working closely with regulatory bodies to ensure a secure integration. We will notify you when this track opens."
      />
    );
  }

  if (reviewState === "not_submitted") {
    return (
      <LockedCard
        message="Verify your credentials to unlock your clinical account."
        href="/clinician/verify"
        linkLabel="Submit Credentials"
      />
    );
  }

  if (reviewState === "pending_review") {
    return (
      <LockedCard message="Thanks — your credentials are being reviewed. You'll be notified when your account is verified." />
    );
  }

  if (reviewState === "rejected") {
    return (
      <LockedCard message="We weren't able to verify your credentials. Please contact info@thebehaviourhive.com for help with your application." />
    );
  }

  return <>{children}</>;
}

function LockedCard({
  message,
  href,
  linkLabel,
}: {
  message: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-brand-off-white/40 px-6 text-center">
      <div className="w-full max-w-xs rounded-3xl bg-white p-6 shadow-lg">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
          <LockIcon className="h-6 w-6" />
        </span>
        <p className="mb-2 text-base font-semibold text-brand-neutral-black">{message}</p>
        {href && linkLabel && (
          <Link
            href={href}
            className="mt-3 block w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white"
          >
            {linkLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
