"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { createClient } from "@/lib/supabase/client";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { CentreBottomNav } from "@/components/respite/CentreBottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { getRoleLabel } from "@/lib/vocabulary";
import type { InstitutionType } from "@/lib/institutionType";
import type { VocabularyOverrides } from "@/lib/vocabulary";

// The centre_manager dashboard build, 25 Sept 2026 -- the full staff
// roster. get_institution_staff_roster() has always been type-agnostic
// (0125); the only existing centre_manager caller (the dashboard's own
// pending-approval queue) discarded every row that wasn't pending. A
// manager could not see who was already on their own team anywhere.
// No deactivate action here yet -- deliberately: get_staff_deactivation_
// preview()'s own shape ("classes or children assigned to") is school-
// specific, and confirming a respite-appropriate equivalent (which
// stays/activations a departing care_staff member leaves behind) is a
// real, separate decision, not invented here. This page is the LIST
// item 3 asked for -- who has joined, and who's waiting.
interface StaffRosterRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_pending: boolean;
}

export default function CentreStaffPage() {
  const { user, isReady } = useRequireRole("centre_manager");
  const membership = useInstitutionMembership(user?.id, "centre_manager");
  const institutionId = membership.institutionId;

  const [roster, setRoster] = useState<StaffRosterRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<StaffRosterRow | null>(null);

  const load = useCallback(async () => {
    if (!institutionId) return;
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_institution_staff_roster", {
      p_institution_id: institutionId,
      p_include_pending: true,
    });
    if (error) {
      setLoadError(error.message);
      setIsLoading(false);
      return;
    }
    setRoster((data ?? []) as StaffRosterRow[]);
    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    load();
  }, [load]);

  if (!isReady || membership.status === "checking") {
    return null;
  }
  if (membership.status === "pending") {
    return <PendingApprovalState waitingFor="centre manager" />;
  }
  if (membership.status === "missing") {
    return <MembershipMissingState noun="centre" />;
  }

  const institutionType: InstitutionType = "respite_centre";
  const overrides: VocabularyOverrides = {};
  const active = roster.filter((r) => r.is_active && !r.is_pending);
  const pending = roster.filter((r) => r.is_pending);

  return (
    <>
      <main className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 px-4 py-6 pb-24 lg:pb-6">
        <div className="mx-auto w-full max-w-2xl">
          <h1 className="mb-4 font-heading text-2xl font-semibold text-brand-neutral-black">Staff</h1>

          {loadError ? (
            <InlineErrorState message={loadError} onRetry={() => load()} />
          ) : isLoading ? null : (
            <>
              {pending.length > 0 && (
                <section className="mb-6">
                  <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-golden-brown">
                    Waiting for approval
                  </h2>
                  <div className="flex flex-col gap-2">
                    {pending.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
                      >
                        <div>
                          <p className="font-semibold text-brand-neutral-black">{member.full_name}</p>
                          <p className="text-xs text-black/50">
                            Requesting to join as {getRoleLabel(member.role, institutionType, overrides)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReviewTarget(member)}
                          className="shrink-0 rounded-full bg-brand-prussian-blue px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Review
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Team
                </h2>
                {active.length === 0 ? (
                  <div className="rounded-2xl border border-black/5 bg-white p-6 text-center shadow-sm">
                    <p className="text-sm text-black/60">No active staff found.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {active.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
                      >
                        <p className="font-semibold text-brand-neutral-black">
                          {member.full_name}
                          {member.user_id === user?.id ? " (you)" : ""}
                        </p>
                        <span className="shrink-0 rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-black/60">
                          {getRoleLabel(member.role, institutionType, overrides)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      <CentreBottomNav />

      {reviewTarget && (
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
    </>
  );
}
