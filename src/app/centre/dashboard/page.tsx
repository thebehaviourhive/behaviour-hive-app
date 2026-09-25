"use client";

import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { useCentreDashboardOverview } from "@/hooks/useCentreDashboardOverview";
import { useOutstandingTaskSnoozes } from "@/hooks/useOutstandingTaskSnoozes";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { TodaySection } from "@/components/respite/TodaySection";
import { ComingAndGoingSection } from "@/components/respite/ComingAndGoingSection";
import { NeedsDoingSection } from "@/components/respite/NeedsDoingSection";
import { WhoIsOnSection } from "@/components/respite/WhoIsOnSection";
import { CentreBottomNav } from "@/components/respite/CentreBottomNav";
import { CentrePageContent } from "@/components/respite/CentrePageContent";
import { BrandMark } from "@/components/ui/BrandMark";

// REBUILT AGAIN, Respite UI Stage 2a -- the previous version (25 Sept
// 2026, kept in spirit below) mirrored PrincipalDashboard/
// ClinicDirectorDashboard's own section shape instead of asking what a
// centre manager's day actually looks like. Two constraints decided
// this rebuild, both named directly: the centre is FULL (two families
// today, thirty on the system tomorrow -- every block holds thirty
// rows without becoming a wall, and looks deliberate holding two), and
// "All clear." was the dashboard's own biggest block, which is
// backwards at any real scale -- at thirty children it would almost
// never appear.
//
// Four blocks, in order, each its own file under src/components/
// respite/: TODAY (who is on-site right now, check-in state, anything
// logged) -- COMING AND GOING (arrivals/departures over 7 days, net
// new, didn't exist anywhere before this) -- NEEDS DOING (the real
// work queue, snoozing intact, "All clear." now one line not the
// centrepiece) -- WHO IS ON (on-call, read-only; no shift/rota data
// exists in this schema to show alongside it, checked directly rather
// than assumed -- see WhoIsOnSection's own header).
//
// Three things moved to their real homes, not duplicated here anymore:
// "Current clients" (removed -- it duplicated /centre/children, a full
// nav destination, for the exact same list); "Set on-call" (moved to
// /centre/settings -- OnCallCard reused there with canSet={true}, read
// -only here); "+ Add a client" (removed -- already lives on /centre/
// children, where adding a client belongs, not the loudest control on
// the dashboard).
//
// Two-column at lg+, using the shared container every /centre screen
// now has room inside (Stage 1, item 3): Today + Coming and going on
// the left, Needs doing + Who is on on the right. Below lg, the two
// column divs are just ordinary block children -- CSS grid does
// nothing until lg:grid applies -- so they stack in the same DOM
// order: Today, Coming and going, Needs doing, Who is on.
export default function CentreManagerDashboardPage() {
  const { user, isReady } = useRequireRole("centre_manager");
  const membership = useInstitutionMembership(user?.id, "centre_manager");
  const institutionId = membership.institutionId;
  const institutionName = membership.institutionName;
  const overview = useCentreDashboardOverview(institutionId);
  const snoozes = useOutstandingTaskSnoozes(institutionId);

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
            {institutionName ?? "Your centre"}
          </h1>

          <div className="lg:grid lg:grid-cols-2 lg:gap-x-10">
            <div className="flex flex-col gap-8">
              <TodaySection onSiteChildren={overview.onSiteChildren} isLoading={overview.isLoading} />
              <ComingAndGoingSection schedule={overview.schedule} isLoading={overview.isLoading} />
            </div>
            <div className="mt-8 flex flex-col gap-8 lg:mt-0">
              <NeedsDoingSection
                institutionId={institutionId}
                awaitingReport={overview.awaitingReport}
                pendingStaff={overview.pendingStaff}
                snoozes={snoozes}
                isLoading={overview.isLoading}
                onResolved={overview.refresh}
              />
              <WhoIsOnSection institutionId={institutionId} />
            </div>
          </div>
        </CentrePageContent>
      </main>

      <CentreBottomNav />
    </>
  );
}
