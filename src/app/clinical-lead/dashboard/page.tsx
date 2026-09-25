"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useClinicalWorkSwitch } from "@/hooks/useClinicalWorkSwitch";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { createClient } from "@/lib/supabase/client";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { MyTagChangeRequestsSection } from "@/components/clinic/MyTagChangeRequestsSection";
import { SnoozableWorkQueueRow } from "@/components/shared/SnoozableWorkQueueRow";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { formatWaitingSince } from "@/lib/workQueueFormatting";
import { useOutstandingTaskSnoozes } from "@/hooks/useOutstandingTaskSnoozes";
import { OUTSTANDING_TASK_QUEUES as Q } from "@/lib/outstandingTaskQueues";

// PRD 10 Stage 5, item 1 -- the lead's own real screen, replacing the
// bare holding page. Three things, per Daniel's own instruction, and
// deliberately nothing else:
//
//  - THE SCOPED CLIENT LIST (get_institution_episode_roster_for_lead,
//    proven against the real database in Stage 4). Each row routes to
//    EITHER the existing clinician clinical file (/clinician/passport/
//    [id]) if this lead also holds active clinician_access to that
//    passport -- the same screen any practitioner uses -- OR the new
//    scope-only view (/clinical-lead/client/[id], item 3) when the
//    client is in scope but not on this lead's own caseload. Resolved
//    once, client-side, by cross-referencing the lead's own
//    clinician_access rows against the scoped roster -- no new RPC
//    needed for this, clinician_access's own SELECT policy already
//    admits reading your own rows.
//
//  - A LINK INTO THEIR OWN CASELOAD -- useClinicalWorkSwitch, the exact
//    mechanism this lead's own holding page already had ("Go to
//    clinical work"). Not rebuilt, reused verbatim.
//
//  - THE APPROVAL QUEUE (get_pending_tag_change_requests_for_lead,
//    0272) -- requests this lead can ACTUALLY decide (non-scoping,
//    within their own scope, toggle on), never the director's full
//    institution-wide list. Approve/decline reuse WorkQueueRow and
//    ReasonConfirmSheet exactly as ClinicDirectorDashboard.tsx does --
//    same components, same shape, a lead-scoped data source.
//
// NO DIRECTOR ACTIONS ANYWHERE ON THIS SCREEN -- not a rule enforced
// here, a structural fact: staff approval, clinic settings, workspace
// emails, the five toggles, and scope management all live under
// /principal/*, gated by a plain useRequireRole("principal") that does
// NOT widen for a clinical_lead (only "clinician" gates widen, via
// is_verified_clinic_director_or_lead(), 0266). This screen has no
// reason to link there and couldn't reach it if it tried.
export default function ClinicalLeadDashboardPage() {
  const { isReady, user } = useRequireRole("clinical_lead");
  // Found retrofitting this page onto useInstitutionMembership.ts, not
  // previously documented: the hand-rolled check this replaced used a
  // SINGLE query with no `approved_at is not null` filter, then branched
  // on the fetched row's own approved_at/rejected_at -- which meant a
  // REJECTED lead fell through to the fully functioning dashboard below
  // (their real scoped client list, their real approval queue), not an
  // error and not a pending state, and a genuinely MISSING row (no
  // institution_staff row at all) rendered a silently empty header with
  // no explanation at all. See the hook's own header for the full
  // account -- this page is now the same, single, correct two-query
  // shape every other institution-scoped dashboard already uses.
  const membership = useInstitutionMembership(user?.id, "clinical_lead");
  const institutionId = membership.institutionId;
  const institutionName = membership.institutionName;
  const snoozes = useOutstandingTaskSnoozes(institutionId);

  const [scopedClients, setScopedClients] = useState<
    { episodeId: string; passportId: string; childName: string; hasOwnCaseload: boolean }[]
  >([]);
  const [pendingRequests, setPendingRequests] = useState<PendingTagChangeRow[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<PendingTagChangeRow | null>(null);

  const clinicalWork = useClinicalWorkSwitch(null);

  const loadDashboard = useCallback(async () => {
    if (!institutionId || !user) return;
    setIsLoadingDashboard(true);
    const supabase = createClient();

    const [rosterResult, caseloadResult, requestsResult] = await Promise.all([
      supabase.rpc("get_institution_episode_roster_for_lead", { p_institution_id: institutionId }),
      supabase
        .from("clinician_access")
        .select("passport_id")
        .eq("clinician_id", user.id)
        .eq("is_active", true),
      supabase.rpc("get_pending_tag_change_requests_for_lead", { p_institution_id: institutionId }),
    ]);

    if (!rosterResult.error) {
      const ownCaseloadPassportIds = new Set(
        ((caseloadResult.data ?? []) as { passport_id: string }[]).map((r) => r.passport_id)
      );
      setScopedClients(
        (rosterResult.data as { episode_id: string; passport_id: string; child_name: string }[]).map((r) => ({
          episodeId: r.episode_id,
          passportId: r.passport_id,
          childName: r.child_name,
          hasOwnCaseload: ownCaseloadPassportIds.has(r.passport_id),
        }))
      );
    }

    if (!requestsResult.error) {
      setPendingRequests((requestsResult.data ?? []) as PendingTagChangeRow[]);
    }

    setIsLoadingDashboard(false);
  }, [institutionId, user]);

  useEffect(() => {
    if (!institutionId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard();
  }, [institutionId, loadDashboard]);

  async function handleApprove(row: PendingTagChangeRow) {
    setApprovingRequestId(row.request_id);
    setApproveError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("approve_tag_change_request", { p_request_id: row.request_id });
    setApprovingRequestId(null);
    if (rpcError) {
      setApproveError(rpcError.message);
      return;
    }
    setPendingRequests((prev) => prev.filter((r) => r.request_id !== row.request_id));
  }

  if (!isReady || membership.status === "checking") {
    return null;
  }

  if (membership.status === "pending") {
    return <PendingApprovalState />;
  }

  if (membership.status === "missing") {
    return <MembershipMissingState noun="clinic" />;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-6 pb-4">
        <h1 className="font-heading text-h1 font-bold text-brand-prussian-blue">Dashboard</h1>
        {institutionName && <p className="mt-0.5 font-sans text-body text-brand-neutral-black/60">{institutionName}</p>}
      </header>

      <main className="flex-1">
        {clinicalWork.shouldShow && (
          <div className="px-4 lg:max-w-[66.6667%]">
            <Link
              href={clinicalWork.href}
              className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
            >
              <p className="font-sans text-body font-semibold text-brand-neutral-black">Your Own Caseload</p>
              <span className="text-xl text-brand-prussian-blue">›</span>
            </Link>
          </div>
        )}

        {!isLoadingDashboard && institutionId && (pendingRequests.length > 0 || snoozes.showSnoozed) && (
          <section className="mt-8 px-4 lg:max-w-[66.6667%]">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                Awaiting Your Decision
              </h2>
              <button
                type="button"
                onClick={() => snoozes.setShowSnoozed((v) => !v)}
                className="font-sans text-eyebrow font-semibold text-brand-prussian-blue underline underline-offset-2"
              >
                {snoozes.showSnoozed ? "Hide snoozed" : "Show snoozed"}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {(snoozes.showSnoozed
                ? pendingRequests
                : snoozes.filterVisible(pendingRequests, Q.PENDING_TAG_CHANGE_REQUEST, (r) => r.request_id)
              ).map((row) => (
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
                  actionLabel={approvingRequestId === row.request_id ? "Approving…" : "Approve"}
                  isActionPending={approvingRequestId === row.request_id}
                  onAction={() => handleApprove(row)}
                  secondaryActionLabel="Decline"
                  onSecondaryAction={() => setDeclineTarget(row)}
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

        {institutionId && <MyTagChangeRequestsSection recordHref={(passportId) => `/clinical-lead/client/${passportId}`} />}

        <section className="mt-8 px-4 lg:max-w-[66.6667%]">
          <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
            Clients Within Your Scope
          </h2>
          {isLoadingDashboard ? (
            <div className="flex flex-col gap-2">
              <div className="h-[64px] animate-pulse rounded-2xl bg-white" />
              <div className="h-[64px] animate-pulse rounded-2xl bg-white" />
            </div>
          ) : scopedClients.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
              No clients currently fall within your scope.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {scopedClients.map((c) => (
                <Link
                  key={c.episodeId}
                  href={c.hasOwnCaseload ? `/clinician/passport/${c.passportId}` : `/clinical-lead/client/${c.passportId}`}
                  className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
                >
                  <p className="font-sans text-body font-semibold text-brand-neutral-black">{c.childName}</p>
                  <span className="text-xl text-brand-prussian-blue">›</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>

      {declineTarget && (
        <ReasonConfirmSheet
          isOpen={!!declineTarget}
          title={`Decline this tag change for ${declineTarget.child_name}?`}
          description="The request stays on record, declined. Whoever raised it can raise a fresh one if the underlying reason still applies."
          confirmLabel="Decline"
          submittingLabel="Declining…"
          onClose={() => setDeclineTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error: rpcError } = await supabase.rpc("decline_tag_change_request", {
              p_request_id: declineTarget.request_id,
              p_decline_reason: reason,
            });
            return { error: rpcError?.message ?? null };
          }}
          onConfirmed={() => {
            setPendingRequests((prev) => prev.filter((r) => r.request_id !== declineTarget.request_id));
            setDeclineTarget(null);
          }}
        />
      )}
    </div>
  );
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
