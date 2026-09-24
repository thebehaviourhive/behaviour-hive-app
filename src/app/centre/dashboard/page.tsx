"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { WorkQueueRow } from "@/components/shared/WorkQueueRow";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
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

export default function CentreManagerDashboardPage() {
  const { user, isReady } = useRequireRole("centre_manager");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [pendingStaff, setPendingStaff] = useState<StaffRosterRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPendingApproval, setIsPendingApproval] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<StaffRosterRow | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();

    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id, institutions(name)")
      .eq("user_id", user.id)
      .eq("role", "centre_manager")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      // Same misdiagnosis this codebase has already found and fixed
      // twice (clinic_admin, clinical_lead): a genuinely PENDING join
      // -- ordinary, expected, nothing wrong -- is not the same state
      // as one that's missing or rejected, and showing the same scary
      // generic error for both is exactly the bug PendingApprovalState
      // exists to close. A second, narrower query distinguishes them.
      const { data: pendingRow } = await supabase
        .from("institution_staff")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "centre_manager")
        .is("deactivated_at", null)
        .is("approved_at", null)
        .is("rejected_at", null)
        .maybeSingle();

      if (pendingRow) {
        setIsPendingApproval(true);
      } else {
        setError("Could not find your centre.");
      }
      setIsLoading(false);
      return;
    }

    const institution = staffRow.institutions as unknown as { name: string } | { name: string }[] | null;
    const name = Array.isArray(institution) ? institution[0]?.name : institution?.name;
    setInstitutionId(staffRow.institution_id);
    setInstitutionName(name ?? null);

    const { data: roster, error: rosterError } = await supabase.rpc("get_institution_staff_roster", {
      p_institution_id: staffRow.institution_id,
      p_include_pending: true,
    });

    if (!rosterError) {
      setPendingStaff(((roster ?? []) as StaffRosterRow[]).filter((s) => s.is_pending));
    }

    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    let isMounted = true;
    async function run() {
      if (!isMounted || !isReady) return;
      await load();
    }
    run();
    return () => {
      isMounted = false;
    };
  }, [isReady, load]);

  if (!isReady || isLoading) {
    return null;
  }

  if (isPendingApproval) {
    return <PendingApprovalState waitingFor="centre manager" />;
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

        {error && (
          <p role="alert" className="mb-4 text-sm font-medium text-red-600">
            {error}
          </p>
        )}

        {!error && pendingStaff.length > 0 && (
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
        )}

        {!error && pendingStaff.length === 0 && (
          <div className="rounded-2xl border border-black/5 bg-white p-4 text-center shadow-sm">
            <p className="text-sm text-black/60">Nothing needs your attention right now.</p>
          </div>
        )}
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
    </main>
  );
}
