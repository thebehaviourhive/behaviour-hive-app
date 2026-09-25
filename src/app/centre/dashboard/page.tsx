"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { useRespiteActiveChildren } from "@/hooks/useRespiteActiveChildren";
import { createClient } from "@/lib/supabase/client";
import { SnoozableWorkQueueRow } from "@/components/shared/SnoozableWorkQueueRow";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";
import { useOutstandingTaskSnoozes } from "@/hooks/useOutstandingTaskSnoozes";
import { OUTSTANDING_TASK_QUEUES as Q } from "@/lib/outstandingTaskQueues";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { OnCallCard } from "@/components/respite/OnCallCard";
import { RedeemLinkCodeSheet } from "@/components/respite/RedeemLinkCodeSheet";
import { OnboardRespiteClientSheet } from "@/components/respite/OnboardRespiteClientSheet";
import { AddClientChoiceSheet } from "@/components/respite/AddClientChoiceSheet";
import { CentreBottomNav } from "@/components/respite/CentreBottomNav";
import { BrandMark } from "@/components/ui/BrandMark";
import { CheckIcon } from "@/components/ui/icons";
import type { InstitutionType } from "@/lib/institutionType";
import type { VocabularyOverrides } from "@/lib/vocabulary";

// REBUILT, 25 Sept 2026 -- the original PRD 11 reachability version
// (own header comment, kept below in spirit) was deliberately minimal:
// "a manager signs in and lands somewhere real, even if it is only an
// empty dashboard." That was correct FOR ITS STAGE. It stopped being
// correct the moment a real capability inventory found a centre_manager
// is the same authority tier as a principal or a clinical director --
// verified at the database (onboard/reopen/discharge a placement, the
// full staff roster) with no surface a human could reach, the identical
// shape CLAUDE.md's own standing rule already names for PRD 10. This
// pass mirrors PrincipalDashboard/ClinicDirectorDashboard's own
// structure directly: a real nav shell (CentreSidebar/CentreBottomNav,
// centreNavTabs.ts), one "Outstanding Work" section (a respite centre's
// own bucket set has no genuine urgent/routine split the way a school's
// does -- matching ClinicDirectorDashboard's single-tier shape, not the
// school dashboard's two-tier one), and the same "All clear." empty
// state both existing dashboards use -- the old "Nothing needs your
// attention right now." copy was already flagged as superseded.
//
// get_institution_staff_roster() and ReviewStaffJoinSheet are both
// reused verbatim from the principal dashboard's own identical bucket,
// unchanged from the original build.
interface StaffRosterRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_pending: boolean;
}

interface AwaitingReportRow {
  stay_id: string;
  passport_id: string;
  child_name: string | null;
  ends_at: string;
}

export default function CentreManagerDashboardPage() {
  const { user, isReady } = useRequireRole("centre_manager");
  const membership = useInstitutionMembership(user?.id, "centre_manager");
  const institutionId = membership.institutionId;
  const institutionName = membership.institutionName;
  const snoozes = useOutstandingTaskSnoozes(institutionId);
  const [pendingStaff, setPendingStaff] = useState<StaffRosterRow[]>([]);
  const [awaitingReport, setAwaitingReport] = useState<AwaitingReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<StaffRosterRow | null>(null);
  const [isRedeemOpen, setIsRedeemOpen] = useState(false);
  const [isOnboardOpen, setIsOnboardOpen] = useState(false);
  const [isAddChoiceOpen, setIsAddChoiceOpen] = useState(false);

  const load = useCallback(async () => {
    if (!institutionId) return;
    const supabase = createClient();

    const [{ data: roster, error: rosterError }, { data: awaiting, error: awaitingError }] = await Promise.all([
      supabase.rpc("get_institution_staff_roster", {
        p_institution_id: institutionId,
        p_include_pending: true,
      }),
      supabase.rpc("get_respite_stays_awaiting_report", { p_institution_id: institutionId }),
    ]);

    if (!rosterError) {
      setPendingStaff(((roster ?? []) as StaffRosterRow[]).filter((s) => s.is_pending));
    }
    if (!awaitingError) {
      setAwaitingReport((awaiting ?? []) as AwaitingReportRow[]);
    }

    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    let isMounted = true;
    async function run() {
      if (!isMounted || !institutionId) return;
      await load();
    }
    run();
    return () => {
      isMounted = false;
    };
  }, [institutionId, load]);

  if (!isReady || membership.status === "checking") {
    return null;
  }

  if (membership.status === "pending") {
    return <PendingApprovalState waitingFor="centre manager" />;
  }

  if (membership.status === "missing") {
    return <MembershipMissingState noun="centre" />;
  }

  if (isLoading) {
    return null;
  }

  const institutionType: InstitutionType = "respite_centre";
  const overrides: VocabularyOverrides = {};
  const awaitingReportVisible = snoozes.filterVisible(awaitingReport, Q.CENTRE_NEEDS_REPORT, (r) => r.stay_id);
  const pendingStaffVisible = snoozes.filterVisible(pendingStaff, Q.PENDING_STAFF_JOIN, (r) => r.id);
  const outstandingCount = awaitingReportVisible.length + pendingStaffVisible.length;

  return (
    <>
      <main className="flex min-h-full flex-1 flex-col items-center bg-brand-off-white/40 px-4 py-10 pb-24 lg:pb-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center lg:hidden">
            <BrandMark />
          </div>
          <h1 className="mb-6 text-center font-heading text-2xl font-semibold text-brand-neutral-black lg:text-left">
            {institutionName ?? "Your centre"}
          </h1>

          <OnCallCard institutionId={institutionId} canSet={true} />

          <button
            type="button"
            onClick={() => setIsAddChoiceOpen(true)}
            className="mb-6 w-full rounded-full bg-brand-golden-brown px-4 py-3 text-center text-sm font-semibold text-white shadow-sm"
          >
            + Add a client
          </button>

          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => snoozes.setShowSnoozed((v) => !v)}
              className="font-sans text-eyebrow font-semibold text-brand-prussian-blue underline underline-offset-2"
            >
              {snoozes.showSnoozed ? "Hide snoozed" : "Show snoozed"}
            </button>
          </div>

          {outstandingCount === 0 && !snoozes.showSnoozed ? (
            <div className="mb-6 flex flex-col items-center gap-1 rounded-2xl bg-white p-8 text-center shadow-sm">
              <CheckIcon className="mb-2 h-6 w-6 text-brand-prussian-blue/40" />
              <p className="font-heading text-h2 font-semibold text-brand-neutral-black">All clear.</p>
              <p className="font-sans text-body text-brand-neutral-black/60">
                There are no outstanding actions requiring your attention today.
              </p>
            </div>
          ) : (
            <section className="mb-6">
              <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                Outstanding Work
              </h2>
              <div className="flex flex-col gap-3">
                {institutionId &&
                  (snoozes.showSnoozed ? awaitingReport : awaitingReportVisible).map((stay) => (
                    <SnoozableWorkQueueRow
                      key={stay.stay_id}
                      institutionId={institutionId}
                      queueKey={Q.CENTRE_NEEDS_REPORT}
                      itemId={stay.stay_id}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.CENTRE_NEEDS_REPORT, stay.stay_id)}
                      onSnoozed={snoozes.refresh}
                      entity={stay.child_name ?? "This child"}
                      exception="Stay ended, no report yet"
                      context={`Ended ${new Date(stay.ends_at).toLocaleDateString()}`}
                      actionLabel="Write report"
                      href={`/centre/report/${stay.stay_id}`}
                      urgent
                    />
                  ))}
                {institutionId &&
                  (snoozes.showSnoozed ? pendingStaff : pendingStaffVisible).map((member) => (
                    <SnoozableWorkQueueRow
                      key={member.id}
                      institutionId={institutionId}
                      queueKey={Q.PENDING_STAFF_JOIN}
                      itemId={member.id}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.PENDING_STAFF_JOIN, member.id)}
                      onSnoozed={snoozes.refresh}
                      entity={member.full_name}
                      exception="Waiting for approval"
                      actionLabel="Approve"
                      onAction={() => setReviewTarget(member)}
                    />
                  ))}
              </div>
            </section>
          )}

          <ActiveChildrenSection institutionId={institutionId} />
        </div>
      </main>

      <CentreBottomNav />

      {reviewTarget && institutionId && (
        <ReviewStaffJoinSheet
          member={reviewTarget}
          isOpen={Boolean(reviewTarget)}
          onClose={() => setReviewTarget(null)}
          onResolved={() => {
            setReviewTarget(null);
            load();
          }}
          institutionType={institutionType}
          overrides={overrides}
        />
      )}

      {institutionId && (
        <RedeemLinkCodeSheet
          isOpen={isRedeemOpen}
          onClose={() => setIsRedeemOpen(false)}
          institutionId={institutionId}
          institutionName={institutionName}
        />
      )}

      {institutionId && (
        <OnboardRespiteClientSheet
          isOpen={isOnboardOpen}
          onClose={() => setIsOnboardOpen(false)}
          institutionId={institutionId}
        />
      )}

      {isAddChoiceOpen && (
        <AddClientChoiceSheet
          onClose={() => setIsAddChoiceOpen(false)}
          onPickRedeem={() => {
            setIsAddChoiceOpen(false);
            setIsRedeemOpen(true);
          }}
          onPickOnboard={() => {
            setIsAddChoiceOpen(false);
            setIsOnboardOpen(true);
          }}
        />
      )}
    </>
  );
}

// get_my_centre_active_children()'s own centre_manager branch -- every
// child with an ACTIVE PLACEMENT, activated or not, matching the
// manager's own placement-scoped reach everywhere else in this PRD.
// isOnSite (useRespiteActiveChildren, resolved against respite_
// activations directly) shows both "placed" and "on-site" plainly.
// Trimmed to a short preview (first 5) with a "View all" link now that
// /centre/children exists as the full directory-equivalent page --
// this section is a quick glance from the dashboard, not the only way
// to reach a child's record.
function ActiveChildrenSection({ institutionId }: { institutionId: string | null }) {
  const { children, isLoading } = useRespiteActiveChildren(institutionId);

  if (isLoading) return null;

  const preview = children.slice(0, 5);

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
          Current clients
        </h2>
        <Link href="/centre/children" className="text-xs font-semibold text-brand-prussian-blue">
          View all
        </Link>
      </div>
      {preview.length === 0 ? (
        <div className="rounded-2xl border border-black/5 bg-white p-4 text-center shadow-sm">
          <p className="text-sm text-black/60">No children currently placed at your centre.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {preview.map((child) => (
            <Link
              key={child.passportId}
              href={`/centre/passport/${child.passportId}`}
              className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
            >
              <p className="font-semibold text-brand-neutral-black">{child.childName ?? "This child"}</p>
              {child.isOnSite ? (
                <span className="shrink-0 rounded-full bg-brand-golden-brown/15 px-2.5 py-1 text-xs font-semibold text-brand-golden-brown">
                  On-site
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-black/50">
                  Placed
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
