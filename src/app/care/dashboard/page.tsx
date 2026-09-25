"use client";

import Link from "next/link";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { useRespiteActiveChildren } from "@/hooks/useRespiteActiveChildren";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { OnCallCard } from "@/components/respite/OnCallCard";
import { BrandMark } from "@/components/ui/BrandMark";

// PRD 11 Stage 5, item 4: the "not built yet" placeholder is replaced
// with a real list -- get_my_centre_active_children()'s own care_staff
// branch, which returns exactly the children with an OPEN ACTIVATION
// for this worker right now, the whole point of activation. The on-call
// card sits above it, readable before any child's record is activated
// at all -- migration 0302's own institution-scoped, role-agnostic read
// policy.
export default function CareStaffDashboardPage() {
  const { user, isReady } = useRequireRole("care_staff");
  const membership = useInstitutionMembership(user?.id, "care_staff");
  const { children, isLoading: childrenLoading } = useRespiteActiveChildren(membership.institutionId);

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
    <main className="flex min-h-full flex-1 flex-col items-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            {membership.institutionName ?? "Your centre"}
          </h1>
        </div>

        <OnCallCard institutionId={membership.institutionId} canSet={false} />

        <section>
          <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
            Active for you
          </h2>
          {childrenLoading ? null : children.length === 0 ? (
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
      </div>
    </main>
  );
}
