"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangleIcon, CheckIcon } from "@/components/ui/icons";
import { AttestationPromptCard } from "@/components/incident-log/AttestationPromptCard";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { IncidentCard, formatIncidentDate, type InstitutionIncidentRow } from "@/components/principal/IncidentCard";

// Minimal principal surface, per the brief: "a sign-off queue and
// access to incidents" -- nothing more. The full principal daily
// dashboard and to-do lists are a separate, later build (PRD 2 Stage
// 7); this page is deliberately not that yet. Read-only for now -- the
// actual countersign action happens on the incident detail page.
//
// Tone: clinical, matching the rest of this module (plain, precise,
// unemotional -- no encouragement/warmth copy, unlike the rest of the
// app's onboarding-adjacent screens).
//
// PRD 2, Stage 1: the row rendering (IncidentCard) is now shared with
// /principal/incidents -- see that component's own header comment for
// what was unioned, what was fixed as a bug, and what was deliberately
// NOT carried over (the old "Debrief required" pill, provably false on
// any signed-off incident -- suppressed pending Stage 7's RPC widening).
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
// and get_institution_withdrawn_attestations() -- see CLAUDE.md's new
// entry for why neither is built on school_notices.
//
// CORRECTION TO THE STAGE 7 RECON REPORT: "inherited incidents...
// rendered nowhere" was wrong. IncidentCard has rendered the inherited
// badge (is_inherited/inherited_from_name/inherited_transferred_at)
// since PRD 1 Stage 3 -- it just had no DEDICATED section calling it
// out as its own to-do item, buried wherever the incident's OTHER
// status happened to sort it. That's what this stage adds for it: not
// a new render, a new SECTION.
//
// Empty state: every bucket below renders only when non-empty. If
// EVERY bucket (join requests, awaiting sign-off, parent calls owed,
// withdrawn attestations, unassigned children, outstanding debriefs,
// inherited incidents) is empty at once, one reassuring card replaces
// all seven rather than seven stacked "nothing here" boxes -- most days
// this is what a principal sees, and it has to read as checked and
// clear, not broken or unbuilt. AttestationPromptCard (the principal's
// OWN attestation duties, distinct from the withdrawn-attestations
// bucket, which is about OTHER staff) stays exactly as it was --
// Daniel's fold-in instruction was for the teacher's dashboard
// specifically, not this one.

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

export default function PrincipalDashboardPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<InstitutionIncidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // PRD 2, Stage 2: the dashboard's own state-aware deep link into
  // Staff's Pending segment. Genuinely the honest minimum: this card
  // shows when there's something to act on and says nothing when there
  // isn't, rather than a placeholder always-there widget.
  const [pendingStaffCount, setPendingStaffCount] = useState(0);
  const [parentCalls, setParentCalls] = useState<RestraintNeedingCallRow[]>([]);
  const [withdrawnAttestations, setWithdrawnAttestations] = useState<WithdrawnAttestationRow[]>([]);
  const [unassignedChildren, setUnassignedChildren] = useState<ChildRosterRow[]>([]);
  const [markingCalledId, setMarkingCalledId] = useState<string | null>(null);
  const [markCalledError, setMarkCalledError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      // approved_at is not null alongside deactivated_at is null -- a
      // pending or rejected principal is structurally unreachable today
      // (CLAUDE.md, Deferred work) but this lookup, and the redirect
      // below, should already be correct for the day handover makes it
      // reachable rather than need a second pass then.
      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id, institutions(name)")
        .eq("user_id", user!.id)
        .eq("role", "principal")
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
        .maybeSingle();

      if (!isMounted) return;

      if (staffError || !staffRow) {
        // Before assuming "no institution at all" (join-institution's
        // job), check for the narrower, genuinely-possible case Stage
        // 1c introduces: this session's own auth claim still says
        // 'principal' (that's the only reason useRequireRole let them
        // reach this page at all) but hand_over_principal() already
        // moved them to a different active role elsewhere in the same
        // transaction. auth.users.app_metadata and institution_staff.role
        // are two separate writes -- getUser() should reflect the fresh
        // claim immediately (this app already depends on that working,
        // via role-select's own POST /api/set-role -> router.push flow),
        // but "should" isn't "always will" for a value this session
        // cached at mount. A silent bounce to the join form would be
        // actively wrong here -- they're not joining anything, they
        // already have a school -- so this is named honestly instead:
        // ask them to sign in again rather than pretend nothing changed.
        const { data: anyActiveRow } = await supabase
          .from("institution_staff")
          .select("id")
          .eq("user_id", user!.id)
          .is("deactivated_at", null)
          .not("approved_at", "is", null)
          .maybeSingle();

        if (!isMounted) return;

        if (anyActiveRow) {
          setError("ROLE_MISMATCH");
          setIsLoading(false);
          return;
        }

        // Genuinely no active row anywhere -- matches teacher/dashboard's
        // own pattern: join-institution's own four-way status resolution
        // is where this belongs, not a dead-end error on this page.
        router.replace("/teacher/join-institution");
        return;
      }

      const institutionRecord = staffRow.institutions as unknown as { name: string } | { name: string }[] | null;
      const name = Array.isArray(institutionRecord) ? institutionRecord[0]?.name : institutionRecord?.name;
      setInstitutionName(name ?? null);

      // PRD 1, Stage 3: lazy materialization, best-effort. resolve_
      // lapsed_incident_ownership() is a real write (0105/0107) --
      // called here, on the principal's own queue load, so an
      // incident sitting owned by a departed supply teacher for a week
      // doesn't wait on someone remembering to trigger it separately.
      // Its own failure is never allowed to block the page from
      // loading incidents at all -- errors here are swallowed
      // deliberately, not surfaced as a page-level error for a
      // correctness nicety, not the main job of this load.
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
      ]);

      if (!isMounted) return;

      if (rpcError) {
        setError("Could not load incidents.");
        setIsLoading(false);
        return;
      }

      // None of the four secondary reads below are fatal on their own --
      // same posture as the pre-existing staff-roster read. Each bucket
      // simply stays empty (and so doesn't render) rather than a second
      // error banner for any one of them.
      if (!staffRosterResult.error) {
        setPendingStaffCount(
          ((staffRosterResult.data ?? []) as { is_pending: boolean }[]).filter((s) => s.is_pending).length
        );
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

      setIncidents((rows ?? []) as InstitutionIncidentRow[]);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, router]);

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

  const nothingOutstanding =
    !isLoading &&
    !error &&
    pendingStaffCount === 0 &&
    awaitingSignoff.length === 0 &&
    parentCalls.length === 0 &&
    withdrawnAttestations.length === 0 &&
    unassignedChildren.length === 0 &&
    outstandingDebriefs.length === 0 &&
    inherited.length === 0;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-start justify-between gap-3 px-4 pt-6 pb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-brand-prussian-blue">
            Incident Log
          </h1>
          {institutionName && (
            <p className="mt-0.5 text-sm text-brand-neutral-black/60">{institutionName}</p>
          )}
        </div>
        {/* Classes/Staff/Incidents links removed -- PrincipalBottomNav
            now owns navigation between top-level screens. Record-incident
            stays: a quick action, not inter-screen navigation. */}
        <Link
          href="/teacher/incidents/new"
          aria-label="Record incident"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-golden-brown text-white shadow-sm"
        >
          <AlertTriangleIcon className="h-5 w-5" />
        </Link>
      </header>

      <main className="flex-1 px-4">
        <AttestationPromptCard className="mb-4" />
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error === "ROLE_MISMATCH" ? (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            <p>Your role at this school has changed. Please sign in again to see your current view.</p>
            <Link
              href="/login"
              className="mt-3 inline-block rounded-2xl bg-brand-prussian-blue px-5 py-2.5 text-sm font-semibold text-white"
            >
              Sign in again
            </Link>
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : (
          <>
            <section className="mb-6">
              <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                Needs your attention
              </h2>

              {nothingOutstanding ? (
                <div className="flex items-center gap-3 rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-brand-neutral-black/60">
                  <CheckIcon className="h-5 w-5 flex-shrink-0 text-brand-prussian-blue/40" />
                  <p>Nothing needs your attention right now.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {pendingStaffCount > 0 && (
                    <Link
                      href="/principal/staff?segment=pending"
                      className="block rounded-2xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-4"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-brand-golden-brown">
                        Join request{pendingStaffCount === 1 ? "" : "s"}
                      </p>
                      <p className="mt-1 text-sm text-brand-neutral-black">
                        {pendingStaffCount} staff member{pendingStaffCount === 1 ? "" : "s"} waiting on your review.
                      </p>
                    </Link>
                  )}

                  {awaitingSignoff.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                        Awaiting your sign-off
                      </h3>
                      <div className="flex flex-col gap-2">
                        {awaitingSignoff.map((incident) => (
                          <IncidentCard key={incident.incident_id} incident={incident} needsSignoff />
                        ))}
                      </div>
                    </div>
                  )}

                  {parentCalls.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                        Parent{parentCalls.length === 1 ? "" : "s"} still to be called
                      </h3>
                      <div className="flex flex-col gap-2">
                        {parentCalls.map((row) => (
                          <div key={row.incident_children_id} className="rounded-2xl border border-brand-golden-brown/30 bg-white p-4 shadow-sm">
                            <Link href={`/teacher/incidents/${row.incident_id}`} className="block">
                              <p className="text-sm font-semibold text-brand-neutral-black">
                                {row.child_name ?? `Child ${row.child_index}`}
                              </p>
                              <p className="mt-0.5 text-xs text-brand-neutral-black/60">
                                {formatIncidentDate(row.occurred_at)} · {row.location}
                                {row.owning_teacher_name ? ` · ${row.owning_teacher_name}` : ""}
                              </p>
                            </Link>
                            <button
                              type="button"
                              onClick={() => handleMarkCalled(row)}
                              disabled={markingCalledId === row.incident_children_id}
                              className="mt-3 rounded-xl border border-brand-golden-brown/40 px-3 py-1.5 text-xs font-semibold text-brand-golden-brown disabled:opacity-50"
                            >
                              {markingCalledId === row.incident_children_id ? "Marking…" : "Mark called"}
                            </button>
                          </div>
                        ))}
                        {markCalledError && (
                          <p role="alert" className="text-xs font-medium text-brand-golden-brown">
                            {markCalledError}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {withdrawnAttestations.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                        Withdrawn attestation{withdrawnAttestations.length === 1 ? "" : "s"}
                      </h3>
                      <div className="flex flex-col gap-2">
                        {withdrawnAttestations.map((row) => (
                          <Link
                            key={row.incident_staff_id}
                            href={`/teacher/incidents/${row.incident_id}`}
                            className="block rounded-2xl border border-brand-golden-brown/30 bg-white p-4 shadow-sm"
                          >
                            <p className="text-sm font-semibold text-brand-neutral-black">
                              {row.staff_name ?? "A staff member"}
                            </p>
                            <p className="mt-0.5 text-xs text-brand-neutral-black/60">
                              {formatIncidentDate(row.occurred_at)} · {row.location}
                            </p>
                            <p className="mt-1.5 text-xs text-brand-golden-brown">
                              &ldquo;{row.withdrawal_reason}&rdquo; -- {row.withdrawn_by_name ?? "withdrawn"}
                            </p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {unassignedChildren.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                        Enrolled, not yet assigned to a class
                      </h3>
                      <div className="flex flex-col gap-2">
                        {unassignedChildren.map((child) => (
                          <Link
                            key={child.passport_id}
                            href={`/principal/passports/${child.passport_id}`}
                            className="block rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
                          >
                            <p className="text-sm font-semibold text-brand-neutral-black">{child.child_name}</p>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {outstandingDebriefs.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                        Debrief{outstandingDebriefs.length === 1 ? "" : "s"} outstanding
                      </h3>
                      <div className="flex flex-col gap-2">
                        {outstandingDebriefs.map((incident) => (
                          <IncidentCard key={incident.incident_id} incident={incident} />
                        ))}
                      </div>
                    </div>
                  )}

                  {inherited.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                        Inherited from a supply teacher
                      </h3>
                      <div className="flex flex-col gap-2">
                        {inherited.map((incident) => (
                          <IncidentCard key={incident.incident_id} incident={incident} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                All incidents
              </h2>
              {rest.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No other incidents recorded.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {rest.map((incident) => (
                    <IncidentCard key={incident.incident_id} incident={incident} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <PrincipalBottomNav />
    </div>
  );
}
