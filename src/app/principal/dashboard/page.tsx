"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangleIcon, CheckIcon } from "@/components/ui/icons";
import { AttestationPromptCard } from "@/components/incident-log/AttestationPromptCard";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";
import { MarkSupportAlertFollowedUpSheet } from "@/components/principal/MarkSupportAlertFollowedUpSheet";
import { PrincipalActivityCard } from "@/components/principal/PrincipalActivityCard";
import { IncidentCard, type InstitutionIncidentRow } from "@/components/principal/IncidentCard";
import { WorkQueueRow } from "@/components/shared/WorkQueueRow";
import { formatWaitingSince } from "@/lib/workQueueFormatting";

// Minimal principal surface, per the brief: "a sign-off queue and
// access to incidents" -- nothing more. The full principal daily
// dashboard and to-do lists are a separate, later build (PRD 2 Stage
// 7); this page is deliberately not that yet. Read-only for now -- the
// actual countersign action happens on the incident detail page.
//
// PRD 2, Stage 7: the "later build" above is this build. Seven action-
// item buckets, five of which needed no new SQL at all -- three already
// live on get_institution_incidents() (awaiting-countersignature,
// outstanding debriefs, inherited-from-a-supply-teacher: all three are
// derivable from teacher_signed_at/countersigned_at/debrief_required/
// is_inherited, columns this RPC has returned since 0107), one on
// get_institution_staff_roster() (pending joins, already fetched here
// before this stage), one on get_institution_child_roster() (enrolled-
// but-unassigned, current_class_id is null). Only two needed new
// migration 0134 RPCs: get_institution_restraints_needing_parent_call()
// and get_institution_withdrawn_attestations().
//
// PRD 4, Stage 2 -- work-queue rewrite. Every bucket now renders through
// the one shared WorkQueueRow (src/components/shared/WorkQueueRow.tsx),
// grouped exactly as the PRD's Dashboard section specifies: NEEDS ACTION
// NOW (parent calls, withdrawn attestations, inherited incidents) under
// a Golden Brown eyebrow on a subtle Pastel Blue row background; ROUTINE
// (countersignatures, join requests, unassigned children, outstanding
// debriefs) under a Prussian Blue eyebrow on plain white rows. Passport
// completions outstanding -- a real eighth bucket, added in PRD 3 Stage
// 3, after this PRD's own "seven categories" text was written -- placed
// under Routine; not named in the PRD, not dropped either, since dropping
// a working bucket would be a behaviour change, not a presentation one.
//
// No SQL this stage (Daniel's own instruction). Two consequences worth
// naming: (1) Join requests moves from a bare count to one row per
// pending person -- get_institution_staff_roster() already returns
// full_name and is_pending, so this was a client-side change only, not
// a widening. Its Action ("Approve") opens the existing
// ReviewStaffJoinSheet, unchanged, same as /principal/staff already
// does -- reused, not reimplemented. (2) Four buckets across both
// dashboards have no timestamp to show as Context and render none --
// see WorkQueueRow's own header comment for the audit. The three
// incident-derived buckets below (countersignatures, debriefs,
// inherited) use LOCATION as Entity, not a child name:
// get_institution_incidents() has never resolved real child names (only
// per-incident child_index codes -- IncidentCard, the row this replaces
// for these three buckets, has never shown one either), and that's a
// deliberate privacy boundary this stage preserves rather than a gap to
// fill in a presentation pass.
//
// Empty state: every bucket below renders only when non-empty. If every
// bucket is empty at once, one reassuring card replaces all of them --
// most days this is what a principal sees, and it has to read as
// checked and clear, not broken or unbuilt. Copy matches the PRD's own
// design-system spec verbatim now ("All clear." / "There are no
// outstanding actions requiring your attention today."), not the
// earlier ad hoc "Nothing needs your attention right now."
// AttestationPromptCard (the principal's OWN attestation duties,
// distinct from the withdrawn-attestations bucket, which is about OTHER
// staff) stays exactly as it was -- Daniel's fold-in instruction was for
// the teacher's dashboard specifically, not this one.

interface RestraintNeedingCallRow {
  incident_children_id: string;
  incident_id: string;
  occurred_at: string;
  location: string;
  child_index: string;
  child_name: string | null;
  owning_teacher_name: string | null;
}

interface WithdrawnAttestationRow {
  incident_id: string;
  incident_staff_id: string;
  occurred_at: string;
  location: string;
  staff_user_id: string;
  staff_name: string | null;
  withdrawn_at: string;
  withdrawn_by: string;
  withdrawn_by_name: string | null;
  withdrawal_reason: string;
  is_closed: boolean;
}

interface ChildRosterRow {
  passport_id: string;
  child_name: string;
  enrolment_ended_at: string | null;
  current_class_id: string | null;
}

// PRD 3, Stage 3 -- sixth instance of the established bucket pattern.
// No status field -- "outstanding" is the RPC's own filter
// (passports.section_a_complete = false), not a column this row carries.
interface PassportCompletionOutstandingRow {
  id: string;
  passport_id: string;
  child_name: string;
  recipient_name: string | null;
  created_at: string;
}

interface StaffRosterRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_pending: boolean;
}

// Migration 0157, Support Button item 7 -- the ninth bucket (PRD 3
// Stage 3 already made this dashboard's eight, per that page's own
// header comment; this correction is worth restating here so the count
// doesn't quietly drift again). Only closed, non-mistap, not-yet-
// followed-up alerts with no non-draft incident already referencing
// them -- see get_institution_outstanding_support_alerts()'s own header
// for why open and cancelled alerts never reach this bucket at all.
interface OutstandingSupportAlertRow {
  id: string;
  raised_by_name: string | null;
  room_names: string[];
  raised_at: string;
}

function childCountLabel(childIndices: string[] | null): string {
  const count = (childIndices ?? []).length;
  return `${count} child${count === 1 ? "" : "ren"} named`;
}

export default function PrincipalDashboardPage() {
  const { user, isReady } = useRequireRole("principal");
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<InstitutionIncidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingStaff, setPendingStaff] = useState<StaffRosterRow[]>([]);
  const [parentCalls, setParentCalls] = useState<RestraintNeedingCallRow[]>([]);
  const [withdrawnAttestations, setWithdrawnAttestations] = useState<WithdrawnAttestationRow[]>([]);
  const [unassignedChildren, setUnassignedChildren] = useState<ChildRosterRow[]>([]);
  const [passportCompletionsOutstanding, setPassportCompletionsOutstanding] = useState<PassportCompletionOutstandingRow[]>([]);
  const [outstandingSupportAlerts, setOutstandingSupportAlerts] = useState<OutstandingSupportAlertRow[]>([]);
  const [markingCalledId, setMarkingCalledId] = useState<string | null>(null);
  const [markCalledError, setMarkCalledError] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<StaffRosterRow | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<OutstandingSupportAlertRow | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    // approved_at is not null alongside deactivated_at is null -- a
    // pending or rejected principal is structurally unreachable today
    // (CLAUDE.md, Deferred work) but this lookup, and the redirect
    // below, should already be correct for the day handover makes it
    // reachable rather than need a second pass then.
    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id, institutions(name)")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      // Before assuming "no institution at all" (join-institution's
      // job), check for the narrower, genuinely-possible case Stage 1c
      // introduces: this session's own auth claim still says
      // 'principal' (that's the only reason useRequireRole let them
      // reach this page at all) but hand_over_principal() already moved
      // them to a different active role elsewhere in the same
      // transaction. A silent bounce to the join form would be actively
      // wrong here -- they're not joining anything, they already have a
      // school -- so this is named honestly instead: ask them to sign
      // in again rather than pretend nothing changed.
      const { data: anyActiveRow } = await supabase
        .from("institution_staff")
        .select("id")
        .eq("user_id", user.id)
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
        .maybeSingle();

      if (anyActiveRow) {
        setError("ROLE_MISMATCH");
        setIsLoading(false);
        return;
      }

      router.replace("/teacher/join-institution");
      return;
    }

    const institutionRecord = staffRow.institutions as unknown as { name: string } | { name: string }[] | null;
    const name = Array.isArray(institutionRecord) ? institutionRecord[0]?.name : institutionRecord?.name;
    setInstitutionName(name ?? null);

    // PRD 1, Stage 3: lazy materialization, best-effort. Its own
    // failure is never allowed to block the page from loading incidents
    // at all -- errors here are swallowed deliberately.
    try {
      await supabase.rpc("resolve_lapsed_incident_ownership", { p_institution_id: staffRow.institution_id });
    } catch {
      // best-effort; see comment above
    }

    const [
      { data: rows, error: rpcError },
      staffRosterResult,
      parentCallResult,
      withdrawnAttestationResult,
      childRosterResult,
      passportCompletionsResult,
      outstandingSupportAlertsResult,
    ] = await Promise.all([
      supabase.rpc("get_institution_incidents", { p_institution_id: staffRow.institution_id }),
      supabase.rpc("get_institution_staff_roster", {
        p_institution_id: staffRow.institution_id,
        p_include_inactive: false,
        p_include_pending: true,
      }),
      supabase.rpc("get_institution_restraints_needing_parent_call", { p_institution_id: staffRow.institution_id }),
      supabase.rpc("get_institution_withdrawn_attestations", { p_institution_id: staffRow.institution_id }),
      supabase.rpc("get_institution_child_roster", { p_institution_id: staffRow.institution_id }),
      supabase.rpc("get_institution_passport_completions_outstanding", { p_institution_id: staffRow.institution_id }),
      supabase.rpc("get_institution_outstanding_support_alerts", { p_institution_id: staffRow.institution_id }),
    ]);

    if (rpcError) {
      setError("Could not load incidents.");
      setIsLoading(false);
      return;
    }

    // None of the five secondary reads below are fatal on their own --
    // each bucket simply stays empty (and so doesn't render) rather
    // than a second error banner for any one of them.
    if (!staffRosterResult.error) {
      setPendingStaff(((staffRosterResult.data ?? []) as StaffRosterRow[]).filter((s) => s.is_pending));
    }
    if (!parentCallResult.error) {
      setParentCalls((parentCallResult.data ?? []) as RestraintNeedingCallRow[]);
    }
    if (!withdrawnAttestationResult.error) {
      setWithdrawnAttestations((withdrawnAttestationResult.data ?? []) as WithdrawnAttestationRow[]);
    }
    if (!childRosterResult.error) {
      const roster = (childRosterResult.data ?? []) as ChildRosterRow[];
      setUnassignedChildren(roster.filter((c) => !c.enrolment_ended_at && c.current_class_id === null));
    }
    if (!passportCompletionsResult.error) {
      setPassportCompletionsOutstanding((passportCompletionsResult.data ?? []) as PassportCompletionOutstandingRow[]);
    }
    if (!outstandingSupportAlertsResult.error) {
      setOutstandingSupportAlerts((outstandingSupportAlertsResult.data ?? []) as OutstandingSupportAlertRow[]);
    }

    setIncidents((rows ?? []) as InstitutionIncidentRow[]);
    setIsLoading(false);
  }, [user, router]);

  useEffect(() => {
    let isMounted = true;
    async function run() {
      if (!isMounted) return;
      await load();
    }
    run();
    return () => {
      isMounted = false;
    };
  }, [load]);

  async function handleMarkCalled(row: RestraintNeedingCallRow) {
    setMarkingCalledId(row.incident_children_id);
    setMarkCalledError(null);
    const supabase = createClient();
    const { error: markError } = await supabase.rpc("mark_parent_called", {
      p_incident_children_id: row.incident_children_id,
    });
    setMarkingCalledId(null);
    if (markError) {
      setMarkCalledError(markError.message);
      return;
    }
    setParentCalls((prev) => prev.filter((r) => r.incident_children_id !== row.incident_children_id));
  }

  if (!isReady) {
    return null;
  }

  const awaitingSignoff = incidents.filter((i) => i.teacher_signed_at && !i.countersigned_at);
  const rest = incidents.filter((i) => !(i.teacher_signed_at && !i.countersigned_at));
  // Outstanding = still blocking the teacher's own sign-off -- 0077's
  // trigger guarantees a completed debrief exists the moment teacher_
  // signed_at is set, so debrief_required alone (without this second
  // condition) would be provably false on every signed-off incident,
  // exactly the reason IncidentCard's own old pill was removed.
  const outstandingDebriefs = incidents.filter((i) => i.debrief_required && !i.teacher_signed_at);
  const inherited = incidents.filter((i) => i.is_inherited);

  const needsActionCount =
    parentCalls.length + withdrawnAttestations.length + inherited.length + outstandingSupportAlerts.length;
  const routineCount =
    awaitingSignoff.length +
    pendingStaff.length +
    unassignedChildren.length +
    outstandingDebriefs.length +
    passportCompletionsOutstanding.length;

  const nothingOutstanding = !isLoading && !error && needsActionCount === 0 && routineCount === 0;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-start justify-between gap-3 px-4 pt-6 pb-4">
        <div>
          <h1 className="font-heading text-h1 font-bold text-brand-prussian-blue">Incident Log</h1>
          {institutionName && (
            <p className="mt-0.5 font-sans text-body text-brand-neutral-black/60">{institutionName}</p>
          )}
        </div>
        {/* Classes/Staff/Incidents links removed -- PrincipalBottomNav
            (and, at lg+, PrincipalSidebar) now owns navigation between
            top-level screens. Record-incident stays: a quick action,
            not inter-screen navigation.

            PRD 4, Stage 6 -- "View Term Overview" joins it here, lg+
            only. Deliberately NOT in primary nav (it's one level down
            from the work queue by design); this button and the feed-
            top one below are its only entry point, and only one of the
            two ever renders at a given width. */}
        <div className="flex flex-shrink-0 items-center gap-2">
          <Link
            href="/principal/term-overview"
            className="hidden flex-shrink-0 rounded-full border border-brand-prussian-blue px-4 py-2.5 font-sans text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue lg:inline-flex lg:items-center"
          >
            View Term Overview
          </Link>
          <Link
            href="/teacher/incidents/new"
            aria-label="Record incident"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-golden-brown text-white shadow-sm"
          >
            <AlertTriangleIcon className="h-5 w-5" />
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4">
        <Link
          href="/principal/term-overview"
          className="mb-4 flex items-center justify-center rounded-2xl border border-brand-prussian-blue px-4 py-3 font-sans text-body font-bold text-brand-prussian-blue lg:hidden"
        >
          View Term Overview
        </Link>
        <AttestationPromptCard className="mb-4" />
        {isLoading ? (
          // Skeleton rows mirror the final layout -- uniform placeholder
          // widths (a standard 120px for every name), not the incident's
          // own varying content, so this reads as loading rather than as
          // content that failed to arrive.
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 rounded-2xl border border-black/5 bg-white p-4">
                <div className="h-5 w-[120px] flex-shrink-0 rounded bg-black/10" />
                <div className="h-4 flex-1 rounded bg-black/5" />
              </div>
            ))}
          </div>
        ) : error === "ROLE_MISMATCH" ? (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
            <p>Your role at this school has changed. Please sign in again to see your current view.</p>
            <Link
              href="/login"
              className="mt-3 inline-block rounded-2xl bg-brand-prussian-blue px-5 py-2.5 font-sans text-body font-semibold text-white"
            >
              Sign in again
            </Link>
          </div>
        ) : error ? (
          <p className="font-sans text-body text-brand-neutral-black/60">{error}</p>
        ) : nothingOutstanding ? (
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-white p-8 text-center shadow-sm">
            <CheckIcon className="mb-2 h-6 w-6 text-brand-prussian-blue/40" />
            <p className="font-heading text-h2 font-semibold text-brand-neutral-black">All clear.</p>
            <p className="font-sans text-body text-brand-neutral-black/60">
              There are no outstanding actions requiring your attention today.
            </p>
          </div>
        ) : (
          <>
            {needsActionCount > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-golden-brown">
                  Needs action now
                </h2>
                <div className="flex flex-col gap-2">
                  {parentCalls.map((row) => (
                    <WorkQueueRow
                      key={row.incident_children_id}
                      urgent
                      entity={row.child_name ?? `Child ${row.child_index}`}
                      exception="Parent still to be called"
                      context={formatWaitingSince(row.occurred_at)}
                      actionLabel={markingCalledId === row.incident_children_id ? "Marking…" : "Mark called"}
                      isActionPending={markingCalledId === row.incident_children_id}
                      onAction={() => handleMarkCalled(row)}
                    />
                  ))}
                  {withdrawnAttestations.map((row) => (
                    <WorkQueueRow
                      key={row.incident_staff_id}
                      urgent
                      entity={row.staff_name ?? "A staff member"}
                      exception={`"${row.withdrawal_reason}" — withdrawn by ${row.withdrawn_by_name ?? "a colleague"}`}
                      context={formatWaitingSince(row.withdrawn_at)}
                      actionLabel="Review"
                      href={`/teacher/incidents/${row.incident_id}`}
                    />
                  ))}
                  {inherited.map((incident) => (
                    <WorkQueueRow
                      key={incident.incident_id}
                      urgent
                      entity={incident.location}
                      exception={`Inherited from ${incident.inherited_from_name ?? "a departed supply teacher"}${
                        incident.created_by_name ? ` · originally recorded by ${incident.created_by_name}` : ""
                      }`}
                      context={incident.inherited_transferred_at ? formatWaitingSince(incident.inherited_transferred_at) : undefined}
                      actionLabel="Review"
                      href={`/teacher/incidents/${incident.incident_id}`}
                    />
                  ))}
                  {outstandingSupportAlerts.map((alert) => (
                    <WorkQueueRow
                      key={alert.id}
                      urgent
                      entity={alert.raised_by_name ?? "A staff member"}
                      exception={`Alert triggered at ${new Date(alert.raised_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}${alert.room_names.length > 0 ? ` - ${alert.room_names.join(", ")}` : ""}`}
                      context={formatWaitingSince(alert.raised_at)}
                      actionLabel="Mark Followed Up"
                      onAction={() => setFollowUpTarget(alert)}
                    />
                  ))}
                  {markCalledError && (
                    <p role="alert" className="font-sans text-eyebrow font-medium text-brand-golden-brown">
                      {markCalledError}
                    </p>
                  )}
                </div>
              </section>
            )}

            {routineCount > 0 && (
              <section>
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                  Routine
                </h2>
                <div className="flex flex-col gap-2">
                  {awaitingSignoff.map((incident) => (
                    <WorkQueueRow
                      key={incident.incident_id}
                      entity={incident.location}
                      exception={`${childCountLabel(incident.child_indices)} · awaiting your sign-off`}
                      context={incident.teacher_signed_at ? formatWaitingSince(incident.teacher_signed_at) : undefined}
                      actionLabel="Countersign"
                      href={`/teacher/incidents/${incident.incident_id}`}
                    />
                  ))}
                  {pendingStaff.map((member) => (
                    <WorkQueueRow
                      key={member.id}
                      entity={member.full_name}
                      exception="Waiting for approval"
                      actionLabel="Approve"
                      onAction={() => setReviewTarget(member)}
                    />
                  ))}
                  {unassignedChildren.map((child) => (
                    <WorkQueueRow
                      key={child.passport_id}
                      entity={child.child_name}
                      exception="Enrolled, not yet assigned to a class"
                      actionLabel="Review"
                      href={`/principal/passports/${child.passport_id}`}
                    />
                  ))}
                  {passportCompletionsOutstanding.map((row) => (
                    <WorkQueueRow
                      key={row.id}
                      entity={row.child_name}
                      exception={`Asked of ${row.recipient_name ?? "a guardian"}`}
                      context={formatWaitingSince(row.created_at)}
                      actionLabel="Review"
                      href={`/principal/passports/${row.passport_id}`}
                    />
                  ))}
                  {outstandingDebriefs.map((incident) => (
                    <WorkQueueRow
                      key={incident.incident_id}
                      entity={incident.location}
                      exception={`${childCountLabel(incident.child_indices)} · debrief outstanding`}
                      context={formatWaitingSince(incident.occurred_at)}
                      actionLabel="Review"
                      href={`/teacher/incidents/${incident.incident_id}`}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* Daniel's own call, reversing the original placement: Recent
            Activity now sits above the incident list rather than below
            it -- institution-wide operational context (support alerts
            today) belongs before the incident history, not after it. */}
        {!isLoading && !error && <PrincipalActivityCard />}

        {!isLoading && !error && (
          <section className="mt-6">
            <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
              All incidents
            </h2>
            {rest.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
                No other incidents recorded.
              </p>
            ) : (
              // Unchanged, IncidentCard -- this is the incident history,
              // not a work-queue bucket (nothing here needs an action),
              // and its own table/row treatment is Stage 3's job
              // ("Incidents and countersigning"), not this one's.
              <div className="flex flex-col gap-2">
                {rest.map((incident) => (
                  <IncidentCard key={incident.incident_id} incident={incident} />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {reviewTarget && (
        <ReviewStaffJoinSheet
          member={reviewTarget}
          isOpen={Boolean(reviewTarget)}
          onClose={() => setReviewTarget(null)}
          onResolved={() => {
            setReviewTarget(null);
            load();
          }}
        />
      )}

      {followUpTarget && (
        <MarkSupportAlertFollowedUpSheet
          alert={followUpTarget}
          isOpen={Boolean(followUpTarget)}
          onClose={() => setFollowUpTarget(null)}
          onResolved={() => {
            setFollowUpTarget(null);
            load();
          }}
        />
      )}

      <PrincipalBottomNav />
    </div>
  );
}
