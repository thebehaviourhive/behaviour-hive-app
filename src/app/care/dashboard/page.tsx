"use client";

import Link from "next/link";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { useRespiteActiveChildren } from "@/hooks/useRespiteActiveChildren";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { OnCallCard } from "@/components/respite/OnCallCard";
import { CareBottomNav } from "@/components/respite/CareBottomNav";
import { CentrePageContent } from "@/components/respite/CentrePageContent";
import { BrandMark } from "@/components/ui/BrandMark";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// PRD 11 Stage 5, item 4: the "not built yet" placeholder is replaced
// with a real list -- get_my_centre_active_children()'s own care_staff
// branch, which returns exactly the children with an OPEN ACTIVATION
// for this worker right now, the whole point of activation. The on-call
// card sits above it, readable before any child's record is activated
// at all -- migration 0302's own institution-scoped, role-agnostic read
// policy.
//
// Respite UI Stage 2b -- given the real nav shell /care/* never had
// (CareSidebar/CareBottomNav/careNavTabs.ts) and the same shared
// content container every /centre screen already uses, matching Stage
// 1's own "one content container, one max-width, one alignment rule"
// instruction rather than leaving care_staff's own screens as the one
// place it doesn't apply.
export default function CareStaffDashboardPage() {
  const { user, isReady } = useRequireRole("care_staff");
  const membership = useInstitutionMembership(user?.id, "care_staff");
  const {
    children,
    isLoading: childrenLoading,
    loadError: childrenLoadError,
    refresh: refreshChildren,
  } = useRespiteActiveChildren(membership.institutionId);

  if (!isReady || membership.status === "checking") {
    return null;
  }

  if (membership.status === "pending") {
    return <PendingApprovalState waitingFor="centre manager" />;
  }

  if (membership.status === "missing") {
    return <MembershipMissingState noun="centre" />;
  }

  return (
    <>
    <main className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 px-4 py-10 pb-24 lg:pb-10">
      <CentrePageContent>
        <div className="mb-6 flex flex-col items-center gap-3 text-center lg:hidden">
          <BrandMark />
        </div>
        <h1 className="mb-6 text-center font-heading text-2xl font-semibold text-brand-neutral-black lg:text-left">
          {membership.institutionName ?? "Your centre"}
        </h1>

        <OnCallCard institutionId={membership.institutionId} canSet={false} />

        <section>
          <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
            Active for you
          </h2>
          {childrenLoadError ? (
            <InlineErrorState message={childrenLoadError} onRetry={() => refreshChildren()} />
          ) : childrenLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-16 animate-pulse rounded-2xl bg-white" />
              <div className="h-16 animate-pulse rounded-2xl bg-white" />
            </div>
          ) : children.length === 0 ? (
            <div className="rounded-2xl border border-black/5 bg-white p-4 text-center shadow-sm">
              <p className="text-sm text-black/60">
                Nothing&apos;s been activated for you yet. A centre manager activates a child&apos;s record when
                they arrive for a stay.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {children.map((child) => (
                <Link
                  key={child.passportId}
                  href={`/care/passport/${child.passportId}`}
                  className="block rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
                >
                  <p className="font-semibold text-brand-neutral-black">{child.childName ?? "This child"}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </CentrePageContent>
    </main>
    <CareBottomNav />
    </>
  );
}
