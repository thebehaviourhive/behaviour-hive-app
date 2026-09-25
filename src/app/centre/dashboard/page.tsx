"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { useRespiteActiveChildren } from "@/hooks/useRespiteActiveChildren";
import { createClient } from "@/lib/supabase/client";
import { WorkQueueRow } from "@/components/shared/WorkQueueRow";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { OnCallCard } from "@/components/respite/OnCallCard";
import { RedeemLinkCodeSheet } from "@/components/respite/RedeemLinkCodeSheet";
import { BrandMark } from "@/components/ui/BrandMark";
import type { InstitutionType } from "@/lib/institutionType";
import type { VocabularyOverrides } from "@/lib/vocabulary";

// PRD 11 Stage 2, item 7: "/centre as a minimal route tree -- a
// manager signs in and lands somewhere real, even if it is only an
// empty dashboard." Deliberately NOT the fuller /clinical-lead or
// /clinic-admin dashboards (client lists, scoped records) -- there is
// no placement, no stay, no access model yet (all Stage 3+). This is
// the honest equivalent of what those two roles landed on the day
// their own consent screens shipped, before their real dashboards
// existed: a real screen, not a redirect loop, showing exactly what
// exists today and nothing invented to look fuller than it is.
//
// The one real, working thing this stage gives a centre manager:
// approving the SECOND manager (and any care_staff) who joins after
// them -- Daniel's own explicit verification case ("a second manager
// joins the same centre and is accepted"). Built as a genuine review
// action here rather than proven only at the RPC layer, matching this
// whole PRD's own standing lesson: a mechanism unreachable through a
// real screen is unproven, whatever the database says.
//
// get_institution_staff_roster() and ReviewStaffJoinSheet are both
// reused verbatim from the principal dashboard's own identical bucket
// (src/app/principal/dashboard/page.tsx) -- both were already role-
// and (once fixed, this same stage) institutionType-agnostic; nothing
// here re-derives the pattern.
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
  const [pendingStaff, setPendingStaff] = useState<StaffRosterRow[]>([]);
  const [awaitingReport, setAwaitingReport] = useState<AwaitingReportRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<StaffRosterRow | null>(null);
  const [isRedeemOpen, setIsRedeemOpen] = useState(false);

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

  return (
    <main className="flex min-h-full flex-1 flex-col items-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            {institutionName ?? "Your centre"}
          </h1>
        </div>

        <OnCallCard institutionId={institutionId} canSet={true} />

        <button
          type="button"
          onClick={() => setIsRedeemOpen(true)}
          className="mb-6 w-full rounded-full bg-brand-golden-brown px-4 py-3 text-center text-sm font-semibold text-white shadow-sm"
        >
          + Add a client
        </button>

        {awaitingReport.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-golden-brown">
              Needs a report
            </h2>
            <div className="flex flex-col gap-3">
              {awaitingReport.map((stay) => (
                <WorkQueueRow
                  key={stay.stay_id}
                  entity={stay.child_name ?? "This child"}
                  exception="Stay ended, no report yet"
                  context={`Ended ${new Date(stay.ends_at).toLocaleDateString()}`}
                  actionLabel="Write report"
                  href={`/centre/report/${stay.stay_id}`}
                  urgent
                />
              ))}
            </div>
          </section>
        )}

        {pendingStaff.length > 0 ? (
          <section className="mb-6">
            <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Waiting for approval
            </h2>
            <div className="flex flex-col gap-3">
              {pendingStaff.map((member) => (
                <WorkQueueRow
                  key={member.id}
                  entity={member.full_name}
                  exception="Waiting for approval"
                  actionLabel="Approve"
                  onAction={() => setReviewTarget(member)}
                />
              ))}
            </div>
          </section>
        ) : (
          awaitingReport.length === 0 && (
            <div className="mb-6 rounded-2xl border border-black/5 bg-white p-4 text-center shadow-sm">
              <p className="text-sm text-black/60">Nothing needs your attention right now.</p>
            </div>
          )
        )}

        <ActiveChildrenSection institutionId={institutionId} />
      </div>

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
    </main>
  );
}

// get_my_centre_active_children()'s own centre_manager branch -- every
// child with an ACTIVE PLACEMENT, activated or not, matching the
// manager's own placement-scoped reach everywhere else in this PRD.
// Previously indistinguishable in the UI (both "placed" and "on-site"
// rendered identically); isOnSite (useRespiteActiveChildren, resolved
// against respite_activations directly) now shows both states plainly
// -- Tier 1's own "fix the Current Clients list" item.
function ActiveChildrenSection({ institutionId }: { institutionId: string | null }) {
  const { children, isLoading } = useRespiteActiveChildren(institutionId);

  if (isLoading) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
        Current clients
      </h2>
      {children.length === 0 ? (
        <div className="rounded-2xl border border-black/5 bg-white p-4 text-center shadow-sm">
          <p className="text-sm text-black/60">No children currently placed at your centre.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {children.map((child) => (
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
