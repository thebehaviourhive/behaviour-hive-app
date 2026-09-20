"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { getRoleLabel } from "@/lib/vocabulary";
import { WorkQueueRow } from "@/components/shared/WorkQueueRow";
import { formatWaitingSince } from "@/lib/workQueueFormatting";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";
import { CheckIcon } from "@/components/ui/icons";

// Clinical director's dashboard -- PRD 5 section 9/10, built now that
// Stage 7 delivered the RPC layer (0227) and this PRD's own recon named
// three more buckets newly computable since (0231/0238/0245). Reuses
// the principal's own work-queue pattern verbatim: WorkQueueRow, the
// entity/exception/context/action shape, and the single "nothing needs
// your attention" empty state -- same component, clinic vocabulary,
// not a second implementation.
//
// WHAT THIS REPLACES, RECORDED PLAINLY: the school dashboard this
// screen sits beside (rendered for institutionType === 'school') looks
// unfinished for a clinic only by coincidence -- every one of its own
// buckets is incident/class-derived, and a clinic can never produce an
// incident or a class. Left unbuilt, a clinical director's dashboard
// would have read "All clear." permanently -- not because nothing
// needed attention, but because nothing it looked at could ever be
// true for a clinic. That is a dashboard lying to someone, not an
// empty one.
//
// STANDING CONSTRAINTS, per Daniel's own explicit instruction, not
// negotiable and not to be "improved" later without asking:
//   - NOTHING COMPARATIVE BETWEEN PRACTITIONERS. Caseload size is a
//     count for assigning referrals safely, rendered below as its own
//     reference-only section (never mixed into "outstanding work"),
//     ordered alphabetically by name -- see get_institution_
//     caseload_sizes()'s own migration comment (0257) for why size-
//     descending was wrong the moment it became a list.
//   - ORGANISED BY CLIENT AND BY OUTSTANDING WORK, never by staff
//     member -- every bucket's own Entity column is the CHILD, not the
//     clinician; clinician name lives in Exception/Context text only,
//     as attribution, never as a groupable/sortable axis.
//   - CAPACITY, FUNDED PLACEMENTS, AND OVERDUE REVIEWS STAY OUT. No
//     denominator exists anywhere in this schema for the first, no
//     funding dimension is designated for the second, no threshold is
//     defined for the third -- each waits on a decision, not a build.
//     None are invented here.
//   - get_my_bookings_needing_attention() (PRD 9) is deliberately NOT
//     surfaced here -- it's clinician-facing by design ("their
//     calendar, their session, only they can tell"); pulling it onto a
//     director's dashboard would contradict that decision, not extend
//     it.
//   - ROOM LEFT FOR THE STAGNATION QUEUE (PRD 8 Stage 3): not built,
//     not designed around. This page's own layout -- one outstanding-
//     work section, then a separate reference section -- has nowhere
//     it assumes the stagnation queue's own shape, so adding it later
//     is a new section, not a rework of this one.
//
// THE FBA IS NOT TO BE TOUCHED (CLAUDE.md, standing). The draft-FBA
// bucket reads fba_reports directly (Stage 7's own get_institution_
// draft_fbas(), unmodified) -- nothing here renders, edits, or links
// into any FBA component. "Review" on every FBA/BSP/assessment row
// opens the CHILD's own record (ChildDetail, via /principal/passports),
// never the artefact itself.

interface EpisodeWithoutPractitionerRow {
  episode_id: string;
  passport_id: string;
  child_name: string;
  started_at: string;
}

interface PendingStaffJoinRow {
  institution_staff_id: string;
  staff_user_id: string;
  full_name: string;
  role: string;
  requested_at: string;
}

interface DraftFbaRow {
  fba_id: string;
  passport_id: string;
  child_name: string;
  clinician_id: string;
  clinician_name: string | null;
  status: string;
  created_at: string;
}

interface DraftBspRow {
  bsp_id: string;
  passport_id: string;
  child_name: string;
  clinician_id: string;
  clinician_name: string | null;
  status: string;
  created_at: string;
}

interface IncompleteAssessmentRow {
  assessment_id: string;
  passport_id: string;
  child_name: string;
  clinician_id: string;
  clinician_name: string | null;
  instrument_name: string;
  created_at: string;
}

interface PendingTagChangeRow {
  request_id: string;
  episode_id: string;
  passport_id: string;
  child_name: string;
  requested_by: string;
  requested_at: string;
  base_tags: unknown;
  proposed_tags: unknown;
  reason: string | null;
}

interface PendingGrantRow {
  grant_id: string;
  passport_id: string;
  child_name: string;
  receiving_institution_name: string;
  scope_items: string[];
  proposed_at: string;
}

interface CaseloadRow {
  clinician_id: string;
  full_name: string;
  caseload_size: number;
}

export function ClinicDirectorDashboard({
  institutionId,
  institutionName,
}: {
  institutionId: string;
  institutionName: string | null;
}) {
  const { institutionType, overrides } = useInstitutionType(institutionId);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [episodesWithoutPractitioner, setEpisodesWithoutPractitioner] = useState<EpisodeWithoutPractitionerRow[]>([]);
  const [pendingStaffJoins, setPendingStaffJoins] = useState<PendingStaffJoinRow[]>([]);
  const [draftFbas, setDraftFbas] = useState<DraftFbaRow[]>([]);
  const [draftBsps, setDraftBsps] = useState<DraftBspRow[]>([]);
  const [incompleteAssessments, setIncompleteAssessments] = useState<IncompleteAssessmentRow[]>([]);
  const [pendingTagChanges, setPendingTagChanges] = useState<PendingTagChangeRow[]>([]);
  const [pendingGrants, setPendingGrants] = useState<PendingGrantRow[]>([]);
  const [caseloadSizes, setCaseloadSizes] = useState<CaseloadRow[]>([]);

  const [reviewJoinTarget, setReviewJoinTarget] = useState<PendingStaffJoinRow | null>(null);
  const [approvingTagChangeId, setApprovingTagChangeId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [declineTagChangeTarget, setDeclineTagChangeTarget] = useState<PendingTagChangeRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const [
      episodesResult,
      staffJoinsResult,
      fbasResult,
      bspsResult,
      assessmentsResult,
      tagChangesResult,
      grantsResult,
      caseloadResult,
    ] = await Promise.all([
      supabase.rpc("get_institution_episodes_without_active_practitioner", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_pending_staff_joins", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_draft_fbas", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_draft_bsps", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_incomplete_assessments", { p_institution_id: institutionId }),
      supabase.rpc("get_pending_tag_change_requests", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_pending_cross_org_grants", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_caseload_sizes", { p_institution_id: institutionId }),
    ]);

    if (episodesResult.error) {
      setError("Could not load your clinic's dashboard.");
      setIsLoading(false);
      return;
    }

    setEpisodesWithoutPractitioner((episodesResult.data ?? []) as EpisodeWithoutPractitionerRow[]);
    if (!staffJoinsResult.error) setPendingStaffJoins((staffJoinsResult.data ?? []) as PendingStaffJoinRow[]);
    if (!fbasResult.error) setDraftFbas((fbasResult.data ?? []) as DraftFbaRow[]);
    if (!bspsResult.error) setDraftBsps((bspsResult.data ?? []) as DraftBspRow[]);
    if (!assessmentsResult.error) setIncompleteAssessments((assessmentsResult.data ?? []) as IncompleteAssessmentRow[]);
    if (!tagChangesResult.error) setPendingTagChanges((tagChangesResult.data ?? []) as PendingTagChangeRow[]);
    if (!grantsResult.error) setPendingGrants((grantsResult.data ?? []) as PendingGrantRow[]);
    if (!caseloadResult.error) setCaseloadSizes((caseloadResult.data ?? []) as CaseloadRow[]);

    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleApproveTagChange(row: PendingTagChangeRow) {
    setApprovingTagChangeId(row.request_id);
    setApproveError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("approve_tag_change_request", { p_request_id: row.request_id });
    setApprovingTagChangeId(null);
    if (rpcError) {
      setApproveError(rpcError.message);
      return;
    }
    setPendingTagChanges((prev) => prev.filter((r) => r.request_id !== row.request_id));
  }

  const outstandingCount =
    episodesWithoutPractitioner.length +
    pendingStaffJoins.length +
    draftFbas.length +
    draftBsps.length +
    incompleteAssessments.length +
    pendingTagChanges.length +
    pendingGrants.length;

  const nothingOutstanding = !isLoading && !error && outstandingCount === 0;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-6 pb-4">
        <h1 className="font-heading text-h1 font-bold text-brand-prussian-blue">Dashboard</h1>
        {institutionName && (
          <p className="mt-0.5 font-sans text-body text-brand-neutral-black/60">{institutionName}</p>
        )}
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 rounded-2xl border border-black/5 bg-white p-4">
                <div className="h-5 w-[120px] flex-shrink-0 rounded bg-black/10" />
                <div className="h-4 flex-1 rounded bg-black/5" />
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="font-sans text-body text-brand-neutral-black/60">{error}</p>
        ) : (
          <>
            {nothingOutstanding ? (
              <div className="flex flex-col items-center gap-1 rounded-2xl bg-white p-8 text-center shadow-sm">
                <CheckIcon className="mb-2 h-6 w-6 text-brand-prussian-blue/40" />
                <p className="font-heading text-h2 font-semibold text-brand-neutral-black">All clear.</p>
                <p className="font-sans text-body text-brand-neutral-black/60">
                  There are no outstanding actions requiring your attention today.
                </p>
              </div>
            ) : (
              <section className="mb-6">
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                  Outstanding Work
                </h2>
                <div className="flex flex-col gap-2">
                  {episodesWithoutPractitioner.map((row) => (
                    <WorkQueueRow
                      key={row.episode_id}
                      entity={row.child_name}
                      exception="No practitioner currently assigned"
                      context={formatWaitingSince(row.started_at)}
                      actionLabel="Assign"
                      href="/principal/directory?segment=clinicians"
                    />
                  ))}

                  {pendingStaffJoins.map((row) => (
                    <WorkQueueRow
                      key={row.institution_staff_id}
                      entity={row.full_name}
                      exception={`Requesting to join as ${getRoleLabel(row.role, "clinic", overrides)}`}
                      context={formatWaitingSince(row.requested_at)}
                      actionLabel="Review"
                      onAction={() => setReviewJoinTarget(row)}
                    />
                  ))}

                  {draftFbas.map((row) => (
                    <WorkQueueRow
                      key={row.fba_id}
                      entity={row.child_name}
                      exception={`FBA still in draft — ${row.clinician_name ?? "a practitioner"}`}
                      context={formatWaitingSince(row.created_at)}
                      actionLabel="Review"
                      href={`/principal/passports/${row.passport_id}`}
                    />
                  ))}

                  {draftBsps.map((row) => (
                    <WorkQueueRow
                      key={row.bsp_id}
                      entity={row.child_name}
                      exception={`Behaviour Support Plan still in draft — ${row.clinician_name ?? "a practitioner"}`}
                      context={formatWaitingSince(row.created_at)}
                      actionLabel="Review"
                      href={`/principal/passports/${row.passport_id}`}
                    />
                  ))}

                  {incompleteAssessments.map((row) => (
                    <WorkQueueRow
                      key={row.assessment_id}
                      entity={row.child_name}
                      exception={`${row.instrument_name} not yet completed — ${row.clinician_name ?? "a practitioner"}`}
                      context={formatWaitingSince(row.created_at)}
                      actionLabel="Review"
                      href={`/principal/passports/${row.passport_id}`}
                    />
                  ))}

                  {pendingTagChanges.map((row) => (
                    <WorkQueueRow
                      key={row.request_id}
                      entity={row.child_name}
                      exception={row.reason ? `"${row.reason}"` : "Tag change requested"}
                      context={formatWaitingSince(row.requested_at)}
                      actionLabel={approvingTagChangeId === row.request_id ? "Approving…" : "Approve"}
                      isActionPending={approvingTagChangeId === row.request_id}
                      onAction={() => handleApproveTagChange(row)}
                      secondaryActionLabel="Decline"
                      onSecondaryAction={() => setDeclineTagChangeTarget(row)}
                    />
                  ))}

                  {pendingGrants.map((row) => (
                    <WorkQueueRow
                      key={row.grant_id}
                      entity={row.child_name}
                      exception={`Proposed to ${row.receiving_institution_name} — awaiting parent confirmation`}
                      context={formatWaitingSince(row.proposed_at)}
                      actionLabel="Review"
                      href={`/principal/passports/${row.passport_id}`}
                    />
                  ))}

                  {approveError && (
                    <p role="alert" className="font-sans text-eyebrow font-medium text-brand-golden-brown">
                      {approveError}
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* Reference only, never "outstanding work" -- a standing
                readout for safely assigning new referrals, not a queue
                to clear. Ordered by name (get_institution_caseload_
                sizes()'s own migration comment explains why size-
                descending is refused here). */}
            {caseloadSizes.length > 0 && (
              <section>
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Caseload
                </h2>
                <div className="flex flex-col gap-2">
                  {caseloadSizes.map((row) => (
                    <div
                      key={row.clinician_id}
                      className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-3 shadow-sm"
                    >
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">{row.full_name}</p>
                      <p className="font-sans text-body text-brand-neutral-black/60">
                        {row.caseload_size} child{row.caseload_size === 1 ? "" : "ren"}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {reviewJoinTarget && (
        <ReviewStaffJoinSheet
          member={{ id: reviewJoinTarget.institution_staff_id, full_name: reviewJoinTarget.full_name, role: reviewJoinTarget.role }}
          isOpen={!!reviewJoinTarget}
          onClose={() => setReviewJoinTarget(null)}
          onResolved={() => {
            setReviewJoinTarget(null);
            load();
          }}
          institutionType={institutionType}
          overrides={overrides}
        />
      )}

      {declineTagChangeTarget && (
        <ReasonConfirmSheet
          isOpen={!!declineTagChangeTarget}
          title={`Decline this tag change for ${declineTagChangeTarget.child_name}?`}
          description="The request stays on record, declined. Whoever raised it can raise a fresh one if the underlying reason still applies."
          confirmLabel="Decline"
          submittingLabel="Declining…"
          onClose={() => setDeclineTagChangeTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error: rpcError } = await supabase.rpc("decline_tag_change_request", {
              p_request_id: declineTagChangeTarget.request_id,
              p_decline_reason: reason,
            });
            return { error: rpcError?.message ?? null };
          }}
          onConfirmed={() => {
            setPendingTagChanges((prev) => prev.filter((r) => r.request_id !== declineTagChangeTarget.request_id));
            setDeclineTagChangeTarget(null);
          }}
        />
      )}
    </div>
  );
}
