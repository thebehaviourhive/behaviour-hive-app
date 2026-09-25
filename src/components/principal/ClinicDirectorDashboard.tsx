"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { getRoleLabel } from "@/lib/vocabulary";
import { SnoozableWorkQueueRow } from "@/components/shared/SnoozableWorkQueueRow";
import { formatWaitingSince } from "@/lib/workQueueFormatting";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";
import { CheckIcon } from "@/components/ui/icons";
import { useOutstandingTaskSnoozes } from "@/hooks/useOutstandingTaskSnoozes";
import { OUTSTANDING_TASK_QUEUES as Q } from "@/lib/outstandingTaskQueues";

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
//   - THE STAGNATION QUEUE (PRD 8 Stage 3, "Worth A Look" below) is its
//     OWN section, deliberately never folded into "Outstanding Work" or
//     its shared nothingOutstanding/"All clear." empty state -- that
//     empty state is TRUE for the other buckets (their absence is a
//     real fact: nothing is pending). It would NOT be true here: this
//     queue's own silence usually means "not enough incident history
//     yet," not "checked and fine," and conflating the two is exactly
//     the defect this feature exists to avoid making about a CHILD, now
//     repeated about the dashboard's own confidence in itself. See
//     get_institution_stagnation_queue()'s own migration (0260) for the
//     full reasoning, including why withheld incidents are invisible to
//     it by design and why that is a real, named limitation, not a bug.
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

// The director notification gap, closed -- team_linked already reaches
// an engaged clinician's own activity feed (0294), but a director who
// isn't personally on the case learned nothing at all. Not a
// notification log (this schema's own "QUERY LIVE STATE" rule) -- the
// same standing fact GrantManagementSection's own empty state now
// states plainly on the client record itself, surfaced institution-
// wide here too: a real school link exists and this clinic has
// proposed nothing yet. Self-clears the moment ANY grant is proposed
// for that passport, whatever its eventual status -- proposing is the
// director having looked and acted, not the parent having confirmed.
interface SchoolLinkPendingSharingRow {
  passport_id: string;
  child_name: string;
  school_names: string;
  linked_at: string;
}

interface CaseloadRow {
  clinician_id: string;
  full_name: string;
  caseload_size: number;
}

type StagnationQueueStatus = "no_signed_plan" | "insufficient_evidence" | "rising" | "not_rising";

interface StagnationQueueRow {
  passport_id: string;
  child_name: string;
  bsp_id: string | null;
  bsp_signed_at: string | null;
  queue_status: StagnationQueueStatus;
  incidents_before_count: number;
  incidents_after_count: number;
  incidents_before_rate: number | null;
  incidents_after_rate: number | null;
  incidents_rising: boolean;
  restraints_before_count: number;
  restraints_after_count: number;
  restraints_before_rate: number | null;
  restraints_after_rate: number | null;
  restraints_rising: boolean;
}

export function ClinicDirectorDashboard({
  institutionId,
  institutionName,
}: {
  institutionId: string;
  institutionName: string | null;
}) {
  const { institutionType, overrides } = useInstitutionType(institutionId);
  const snoozes = useOutstandingTaskSnoozes(institutionId);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [episodesWithoutPractitioner, setEpisodesWithoutPractitioner] = useState<EpisodeWithoutPractitionerRow[]>([]);
  const [pendingStaffJoins, setPendingStaffJoins] = useState<PendingStaffJoinRow[]>([]);
  const [draftFbas, setDraftFbas] = useState<DraftFbaRow[]>([]);
  const [draftBsps, setDraftBsps] = useState<DraftBspRow[]>([]);
  const [incompleteAssessments, setIncompleteAssessments] = useState<IncompleteAssessmentRow[]>([]);
  const [pendingTagChanges, setPendingTagChanges] = useState<PendingTagChangeRow[]>([]);
  const [pendingGrants, setPendingGrants] = useState<PendingGrantRow[]>([]);
  const [schoolLinksPendingSharing, setSchoolLinksPendingSharing] = useState<SchoolLinkPendingSharingRow[]>([]);
  const [caseloadSizes, setCaseloadSizes] = useState<CaseloadRow[]>([]);
  const [stagnationQueue, setStagnationQueue] = useState<StagnationQueueRow[]>([]);
  // Session types, fixed -> clinic-configurable catalogue (migration
  // 0281) -- a single fact, not a list (get_institution_has_no_
  // bookable_session_types()'s own migration comment: "boolean...
  // rendered as one WorkQueueRow when true, not a row-per-something
  // bucket like its seven siblings").
  const [hasNoBookableSessionTypes, setHasNoBookableSessionTypes] = useState(false);

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
      schoolLinksResult,
      caseloadResult,
      stagnationResult,
      noBookableSessionTypesResult,
    ] = await Promise.all([
      supabase.rpc("get_institution_episodes_without_active_practitioner", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_pending_staff_joins", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_draft_fbas", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_draft_bsps", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_incomplete_assessments", { p_institution_id: institutionId }),
      supabase.rpc("get_pending_tag_change_requests", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_pending_cross_org_grants", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_school_links_pending_sharing_decision", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_caseload_sizes", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_stagnation_queue", { p_institution_id: institutionId }),
      supabase.rpc("get_institution_has_no_bookable_session_types", { p_institution_id: institutionId }),
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
    if (!schoolLinksResult.error) setSchoolLinksPendingSharing((schoolLinksResult.data ?? []) as SchoolLinkPendingSharingRow[]);
    if (!caseloadResult.error) setCaseloadSizes((caseloadResult.data ?? []) as CaseloadRow[]);
    if (!stagnationResult.error) setStagnationQueue((stagnationResult.data ?? []) as StagnationQueueRow[]);
    if (!noBookableSessionTypesResult.error) setHasNoBookableSessionTypes(Boolean(noBookableSessionTypesResult.data));

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

  // Outstanding-task snoozing, 25 Sept 2026 -- every bucket filtered
  // through the clinic's own current snooze state before either
  // counting or rendering, same discipline as the school dashboard.
  const episodesWithoutPractitionerVisible = snoozes.filterVisible(
    episodesWithoutPractitioner,
    Q.CLINIC_EPISODE_NO_ACTIVE_PRACTITIONER,
    (r) => r.episode_id
  );
  const pendingStaffJoinsVisible = snoozes.filterVisible(
    pendingStaffJoins,
    Q.PENDING_STAFF_JOIN,
    (r) => r.institution_staff_id
  );
  const draftFbasVisible = snoozes.filterVisible(draftFbas, Q.CLINIC_DRAFT_FBA, (r) => r.fba_id);
  const draftBspsVisible = snoozes.filterVisible(draftBsps, Q.CLINIC_DRAFT_BSP, (r) => r.bsp_id);
  const incompleteAssessmentsVisible = snoozes.filterVisible(
    incompleteAssessments,
    Q.CLINIC_INCOMPLETE_ASSESSMENT,
    (r) => r.assessment_id
  );
  const pendingTagChangesVisible = snoozes.filterVisible(
    pendingTagChanges,
    Q.PENDING_TAG_CHANGE_REQUEST,
    (r) => r.request_id
  );
  const pendingGrantsVisible = snoozes.filterVisible(pendingGrants, Q.CLINIC_PENDING_CROSS_ORG_GRANT, (r) => r.grant_id);
  const schoolLinksPendingSharingVisible = snoozes.filterVisible(
    schoolLinksPendingSharing,
    Q.CLINIC_SCHOOL_LINK_PENDING_SHARING,
    (r) => r.passport_id
  );
  const noBookableSessionTypesSnoozed = Boolean(
    hasNoBookableSessionTypes &&
      !snoozes.showSnoozed &&
      snoozes.getMeta(Q.CLINIC_NO_BOOKABLE_SESSION_TYPES, institutionId)?.isCurrentlySnoozed
  );

  const outstandingCount =
    episodesWithoutPractitionerVisible.length +
    pendingStaffJoinsVisible.length +
    draftFbasVisible.length +
    draftBspsVisible.length +
    incompleteAssessmentsVisible.length +
    pendingTagChangesVisible.length +
    pendingGrantsVisible.length +
    schoolLinksPendingSharingVisible.length +
    (hasNoBookableSessionTypes && !noBookableSessionTypesSnoozed ? 1 : 0);

  const nothingOutstanding = !isLoading && !error && outstandingCount === 0;

  // The stagnation queue's own empty state, built deliberately separate
  // from nothingOutstanding above -- Daniel's own instruction: "not
  // enough evidence yet" and "all clear" are different claims, and a
  // director reading the wrong one would be misled by it. rising is the
  // only status that renders a row; the other three are accounted for
  // in the summary text below so a 'no_signed_plan' or
  // 'insufficient_evidence' client is stated plainly, never silently
  // absent (Decision 3).
  const risingClientsAll = stagnationQueue.filter((row) => row.queue_status === "rising");
  const risingClients = snoozes.filterVisible(risingClientsAll, Q.CLINIC_STAGNATION_RISING, (r) => r.passport_id);
  const stableWithEvidenceCount = stagnationQueue.filter((row) => row.queue_status === "not_rising").length;
  const insufficientEvidenceCount = stagnationQueue.filter((row) => row.queue_status === "insufficient_evidence").length;
  const noSignedPlanCount = stagnationQueue.filter((row) => row.queue_status === "no_signed_plan").length;

  const stagnationSummary =
    stableWithEvidenceCount > 0
      ? `No current client is showing a rising trend, based on ${stableWithEvidenceCount} compared with enough incident history to say so.`
      : "Not enough incident history yet to say whether a current plan is working for any client.";
  const stagnationSummaryDetail =
    insufficientEvidenceCount > 0 || noSignedPlanCount > 0
      ? [
          insufficientEvidenceCount > 0
            ? `${insufficientEvidenceCount} ${insufficientEvidenceCount === 1 ? "doesn't" : "don't"} have enough incident history yet to compare either way`
            : null,
          noSignedPlanCount > 0
            ? `${noSignedPlanCount} ${noSignedPlanCount === 1 ? "doesn't" : "don't"} have a signed plan yet`
            : null,
        ]
          .filter(Boolean)
          .join("; ") + "."
      : null;

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
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => snoozes.setShowSnoozed((v) => !v)}
                className="font-sans text-eyebrow font-semibold text-brand-prussian-blue underline underline-offset-2"
              >
                {snoozes.showSnoozed ? "Hide snoozed" : "Show snoozed"}
              </button>
            </div>

            {nothingOutstanding && !snoozes.showSnoozed ? (
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
                  {hasNoBookableSessionTypes && (!noBookableSessionTypesSnoozed || snoozes.showSnoozed) && (
                    <SnoozableWorkQueueRow
                      institutionId={institutionId}
                      queueKey={Q.CLINIC_NO_BOOKABLE_SESSION_TYPES}
                      itemId={institutionId}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.CLINIC_NO_BOOKABLE_SESSION_TYPES, institutionId)}
                      onSnoozed={snoozes.refresh}
                      entity={institutionName ?? "Your clinic"}
                      exception="No bookable session types -- parents cannot book anything yet"
                      actionLabel="Set up"
                      href="/principal/clinic/session-types"
                    />
                  )}

                  {(snoozes.showSnoozed ? episodesWithoutPractitioner : episodesWithoutPractitionerVisible).map((row) => (
                    <SnoozableWorkQueueRow
                      key={row.episode_id}
                      institutionId={institutionId}
                      queueKey={Q.CLINIC_EPISODE_NO_ACTIVE_PRACTITIONER}
                      itemId={row.episode_id}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.CLINIC_EPISODE_NO_ACTIVE_PRACTITIONER, row.episode_id)}
                      onSnoozed={snoozes.refresh}
                      entity={row.child_name}
                      exception="No practitioner currently assigned"
                      context={formatWaitingSince(row.started_at)}
                      actionLabel="Assign"
                      href="/principal/directory?segment=clinicians"
                    />
                  ))}

                  {(snoozes.showSnoozed ? pendingStaffJoins : pendingStaffJoinsVisible).map((row) => (
                    <SnoozableWorkQueueRow
                      key={row.institution_staff_id}
                      institutionId={institutionId}
                      queueKey={Q.PENDING_STAFF_JOIN}
                      itemId={row.institution_staff_id}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.PENDING_STAFF_JOIN, row.institution_staff_id)}
                      onSnoozed={snoozes.refresh}
                      entity={row.full_name}
                      exception={`Requesting to join as ${getRoleLabel(row.role, "clinic", overrides)}`}
                      context={formatWaitingSince(row.requested_at)}
                      actionLabel="Review"
                      onAction={() => setReviewJoinTarget(row)}
                    />
                  ))}

                  {(snoozes.showSnoozed ? draftFbas : draftFbasVisible).map((row) => (
                    <SnoozableWorkQueueRow
                      key={row.fba_id}
                      institutionId={institutionId}
                      queueKey={Q.CLINIC_DRAFT_FBA}
                      itemId={row.fba_id}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.CLINIC_DRAFT_FBA, row.fba_id)}
                      onSnoozed={snoozes.refresh}
                      entity={row.child_name}
                      exception={`FBA still in draft — ${row.clinician_name ?? "a practitioner"}`}
                      context={formatWaitingSince(row.created_at)}
                      actionLabel="Review"
                      href={`/principal/passports/${row.passport_id}`}
                    />
                  ))}

                  {(snoozes.showSnoozed ? draftBsps : draftBspsVisible).map((row) => (
                    <SnoozableWorkQueueRow
                      key={row.bsp_id}
                      institutionId={institutionId}
                      queueKey={Q.CLINIC_DRAFT_BSP}
                      itemId={row.bsp_id}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.CLINIC_DRAFT_BSP, row.bsp_id)}
                      onSnoozed={snoozes.refresh}
                      entity={row.child_name}
                      exception={`Behaviour Support Plan still in draft — ${row.clinician_name ?? "a practitioner"}`}
                      context={formatWaitingSince(row.created_at)}
                      actionLabel="Review"
                      href={`/principal/passports/${row.passport_id}`}
                    />
                  ))}

                  {(snoozes.showSnoozed ? incompleteAssessments : incompleteAssessmentsVisible).map((row) => (
                    <SnoozableWorkQueueRow
                      key={row.assessment_id}
                      institutionId={institutionId}
                      queueKey={Q.CLINIC_INCOMPLETE_ASSESSMENT}
                      itemId={row.assessment_id}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.CLINIC_INCOMPLETE_ASSESSMENT, row.assessment_id)}
                      onSnoozed={snoozes.refresh}
                      entity={row.child_name}
                      exception={`${row.instrument_name} not yet completed — ${row.clinician_name ?? "a practitioner"}`}
                      context={formatWaitingSince(row.created_at)}
                      actionLabel="Review"
                      href={`/principal/passports/${row.passport_id}`}
                    />
                  ))}

                  {(snoozes.showSnoozed ? pendingTagChanges : pendingTagChangesVisible).map((row) => (
                    <SnoozableWorkQueueRow
                      key={row.request_id}
                      institutionId={institutionId}
                      queueKey={Q.PENDING_TAG_CHANGE_REQUEST}
                      itemId={row.request_id}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.PENDING_TAG_CHANGE_REQUEST, row.request_id)}
                      onSnoozed={snoozes.refresh}
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

                  {(snoozes.showSnoozed ? pendingGrants : pendingGrantsVisible).map((row) => (
                    <SnoozableWorkQueueRow
                      key={row.grant_id}
                      institutionId={institutionId}
                      queueKey={Q.CLINIC_PENDING_CROSS_ORG_GRANT}
                      itemId={row.grant_id}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.CLINIC_PENDING_CROSS_ORG_GRANT, row.grant_id)}
                      onSnoozed={snoozes.refresh}
                      entity={row.child_name}
                      exception={`Proposed to ${row.receiving_institution_name} — awaiting parent confirmation`}
                      context={formatWaitingSince(row.proposed_at)}
                      actionLabel="Review"
                      href={`/principal/passports/${row.passport_id}`}
                    />
                  ))}

                  {(snoozes.showSnoozed ? schoolLinksPendingSharing : schoolLinksPendingSharingVisible).map((row) => (
                    <SnoozableWorkQueueRow
                      key={row.passport_id}
                      institutionId={institutionId}
                      queueKey={Q.CLINIC_SCHOOL_LINK_PENDING_SHARING}
                      itemId={row.passport_id}
                      defaultSnoozeDays={snoozes.defaultSnoozeDays}
                      snoozeMeta={snoozes.getMeta(Q.CLINIC_SCHOOL_LINK_PENDING_SHARING, row.passport_id)}
                      onSnoozed={snoozes.refresh}
                      entity={row.child_name}
                      exception={`Now also at ${row.school_names} — nothing shared yet`}
                      context={formatWaitingSince(row.linked_at)}
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

            {/* PRD 8 Stage 3 -- the stagnation queue. Its own section,
                its own empty state, deliberately not merged into
                nothingOutstanding above (see this file's own header
                comment for why). States a fact and stops -- never a
                cause, never a verdict, never sorted by severity (order
                is alphabetical, same as Caseload below). Golden Brown,
                not red -- this is a prompt to look, not a safety alert.
                "Review" opens the CHILD's own record, same as every
                other bucket -- never the incidents themselves. */}
            {!isLoading && !error && (
              <section className="mb-6">
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                  Worth A Look
                </h2>
                {(snoozes.showSnoozed ? risingClientsAll : risingClients).length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {(snoozes.showSnoozed ? risingClientsAll : risingClients).map((row) => {
                      const useRestraintCopy = row.restraints_rising;
                      const exception = useRestraintCopy
                        ? "Physical intervention has increased since their plan began — worth checking in on."
                        : "Incidents have increased since their plan began — worth checking in on.";
                      const beforeRate = useRestraintCopy ? row.restraints_before_rate : row.incidents_before_rate;
                      const afterRate = useRestraintCopy ? row.restraints_after_rate : row.incidents_after_rate;
                      const context =
                        beforeRate !== null && afterRate !== null
                          ? `${beforeRate}/wk before their plan → ${afterRate}/wk since`
                          : undefined;
                      return (
                        <SnoozableWorkQueueRow
                          key={row.passport_id}
                          institutionId={institutionId}
                          queueKey={Q.CLINIC_STAGNATION_RISING}
                          itemId={row.passport_id}
                          defaultSnoozeDays={snoozes.defaultSnoozeDays}
                          snoozeMeta={snoozes.getMeta(Q.CLINIC_STAGNATION_RISING, row.passport_id)}
                          onSnoozed={snoozes.refresh}
                          entity={row.child_name}
                          exception={exception}
                          context={context}
                          actionLabel="Review"
                          href={`/principal/passports/${row.passport_id}`}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-white p-5 shadow-sm">
                    <p className="font-sans text-body text-brand-neutral-black/70">{stagnationSummary}</p>
                    {stagnationSummaryDetail && (
                      <p className="mt-1 font-sans text-eyebrow text-brand-neutral-black/50">{stagnationSummaryDetail}</p>
                    )}
                  </div>
                )}
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
