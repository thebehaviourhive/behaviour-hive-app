"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { AddClassTeacherSheet } from "@/components/principal/AddClassTeacherSheet";
import { AddClassChildSheet } from "@/components/principal/AddClassChildSheet";
import { AssignSnaSheet } from "@/components/shared/AssignSnaSheet";
import { GrantTemporaryAccessSheet } from "@/components/shared/GrantTemporaryAccessSheet";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { formatCutoffTime, todayLocalDateString } from "@/lib/temporaryAccessTime";

// PRD 1, Stage 2, Step 3. Principal's class detail: teachers (add/remove
// within the 3-slot cap), roster (add/remove a child), and per-child SNA
// assignment (assign/reassign, for ANY child at this school -- the
// principal branch of assign_sna_to_child() isn't scoped to this class).
//
// "Ending a membership is ending, never deleting" (Daniel's own
// instruction): removed teachers and children move to a collapsed
// history section, matching /principal/staff's own "Rejected requests"
// idiom exactly -- never dropped from the page.
//
// Names are resolved via get_institution_staff_roster() (staff) and
// get_institution_child_roster() (children) -- the same two RPCs 0074
// already built for exactly this "who is this person/child" problem,
// not a new lookup. get_institution_staff_roster() is called with
// p_include_inactive=true so a removed teacher's name still resolves in
// history, not just while active.

interface TeacherRow {
  id: string;
  userId: string;
  position: number;
  startedAt: string;
  endedAt: string | null;
  endedByName: string | null;
  endReason: string | null;
}

interface ChildRow {
  id: string;
  passportId: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
}

interface Assignment {
  id: string;
  snaUserId: string;
}

interface StaffRosterRow {
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

interface ChildRosterRow {
  passport_id: string;
  child_name: string;
}

interface CoverGrant {
  id: string;
  grantedTo: string;
  grantedForDate: string;
  reason: string;
  revokedAt: string | null;
}

export default function PrincipalClassDetailPage() {
  const params = useParams();
  const classId = params.classId as string;
  const { isReady } = useRequireRole("principal");

  const [className, setClassName] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<{ active: TeacherRow[]; removed: TeacherRow[] }>({ active: [], removed: [] });
  const [children, setChildren] = useState<{ active: ChildRow[]; removed: ChildRow[] }>({ active: [], removed: [] });
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  const [childNameMap, setChildNameMap] = useState<Map<string, string>>(new Map());
  const [assignmentMap, setAssignmentMap] = useState<Map<string, Assignment>>(new Map());
  const [eligibleTeachers, setEligibleTeachers] = useState<{ userId: string; fullName: string }[]>([]);
  const [eligibleSnas, setEligibleSnas] = useState<{ userId: string; fullName: string }[]>([]);
  const [eligibleChildren, setEligibleChildren] = useState<{ passportId: string; childName: string }[]>([]);
  const [eligibleStaffForCover, setEligibleStaffForCover] = useState<{ userId: string; fullName: string }[]>([]);
  const [cutoffTime, setCutoffTime] = useState<string>("15:00:00");
  const [coverGrants, setCoverGrants] = useState<{ active: CoverGrant[]; past: CoverGrant[] }>({ active: [], past: [] });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRemovedTeachers, setShowRemovedTeachers] = useState(false);
  const [showRemovedChildren, setShowRemovedChildren] = useState(false);
  const [showCoverHistory, setShowCoverHistory] = useState(false);

  const [isAddTeacherOpen, setIsAddTeacherOpen] = useState(false);
  const [isAddChildOpen, setIsAddChildOpen] = useState(false);
  const [isGrantCoverOpen, setIsGrantCoverOpen] = useState(false);
  const [removeTeacherTarget, setRemoveTeacherTarget] = useState<TeacherRow | null>(null);
  const [removeChildTarget, setRemoveChildTarget] = useState<ChildRow | null>(null);
  const [assignSnaTarget, setAssignSnaTarget] = useState<ChildRow | null>(null);
  const [revokeCoverTarget, setRevokeCoverTarget] = useState<CoverGrant | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: classRow, error: classErr } = await supabase
      .from("classes")
      .select("id, name, institution_id")
      .eq("id", classId)
      .maybeSingle();

    if (classErr || !classRow) {
      setError("Could not load this class.");
      setIsLoading(false);
      return;
    }
    setClassName(classRow.name);
    setInstitutionId(classRow.institution_id);

    const [teacherRowsResult, childRowsResult, staffRosterResult, childRosterResult, instResult, coverResult] = await Promise.all([
      supabase
        .from("class_teachers")
        .select("id, user_id, position, started_at, ended_at, ended_by, end_reason")
        .eq("class_id", classId)
        .order("position"),
      supabase
        .from("class_children")
        .select("id, passport_id, started_at, ended_at, end_reason")
        .eq("class_id", classId)
        .order("started_at"),
      supabase.rpc("get_institution_staff_roster", {
        p_institution_id: classRow.institution_id,
        p_include_inactive: true,
        p_include_pending: false,
      }),
      supabase.rpc("get_institution_child_roster", { p_institution_id: classRow.institution_id }),
      supabase.from("institutions").select("temporary_access_cutoff_time").eq("id", classRow.institution_id).single(),
      supabase
        .from("temporary_access")
        .select("id, granted_to, granted_for_date, reason, revoked_at")
        .eq("class_id", classId)
        .order("granted_for_date", { ascending: false }),
    ]);

    if (instResult.data?.temporary_access_cutoff_time) {
      setCutoffTime(instResult.data.temporary_access_cutoff_time);
    }
    const today = todayLocalDateString();
    const coverActive: CoverGrant[] = [];
    const coverPast: CoverGrant[] = [];
    for (const g of coverResult.data ?? []) {
      const row: CoverGrant = { id: g.id, grantedTo: g.granted_to, grantedForDate: g.granted_for_date, reason: g.reason, revokedAt: g.revoked_at };
      (g.revoked_at || g.granted_for_date < today ? coverPast : coverActive).push(row);
    }
    setCoverGrants({ active: coverActive, past: coverPast });

    const staffRoster = (staffRosterResult.data ?? []) as StaffRosterRow[];
    const childRoster = (childRosterResult.data ?? []) as ChildRosterRow[];

    const names = new Map<string, string>();
    for (const s of staffRoster) {
      names.set(s.user_id, s.full_name);
    }
    setNameMap(names);

    const childNames = new Map<string, string>();
    for (const c of childRoster) {
      childNames.set(c.passport_id, c.child_name);
    }
    setChildNameMap(childNames);

    const activeTeachers: TeacherRow[] = [];
    const removedTeachers: TeacherRow[] = [];
    for (const t of teacherRowsResult.data ?? []) {
      const row: TeacherRow = {
        id: t.id,
        userId: t.user_id,
        position: t.position,
        startedAt: t.started_at,
        endedAt: t.ended_at,
        endedByName: t.ended_by ? (names.get(t.ended_by) ?? null) : null,
        endReason: t.end_reason,
      };
      (t.ended_at ? removedTeachers : activeTeachers).push(row);
    }
    setTeachers({ active: activeTeachers, removed: removedTeachers });

    const activeChildren: ChildRow[] = [];
    const removedChildren: ChildRow[] = [];
    for (const c of childRowsResult.data ?? []) {
      const row: ChildRow = {
        id: c.id,
        passportId: c.passport_id,
        startedAt: c.started_at,
        endedAt: c.ended_at,
        endReason: c.end_reason,
      };
      (c.ended_at ? removedChildren : activeChildren).push(row);
    }
    setChildren({ active: activeChildren, removed: removedChildren });

    // Active SNA assignments for this class's current children -- an
    // institution-wide table, so this query filters explicitly to this
    // class's passport ids rather than relying on class membership to
    // scope it, matching child_assignments' own RLS (institution-wide,
    // not class-scoped).
    const activePassportIds = activeChildren.map((c) => c.passportId);
    if (activePassportIds.length > 0) {
      const { data: assignmentRows } = await supabase
        .from("child_assignments")
        .select("id, passport_id, user_id")
        .in("passport_id", activePassportIds)
        .is("ended_at", null);
      const assignments = new Map<string, Assignment>();
      for (const a of assignmentRows ?? []) {
        assignments.set(a.passport_id, { id: a.id, snaUserId: a.user_id });
      }
      setAssignmentMap(assignments);
    } else {
      setAssignmentMap(new Map());
    }

    const activeTeacherUserIds = new Set(activeTeachers.map((t) => t.userId));
    setEligibleTeachers(
      staffRoster
        .filter((s) => s.role === "class_teacher" && s.is_active && !activeTeacherUserIds.has(s.user_id))
        .map((s) => ({ userId: s.user_id, fullName: s.full_name }))
    );
    setEligibleSnas(
      staffRoster
        .filter((s) => s.role === "sna" && s.is_active)
        .map((s) => ({ userId: s.user_id, fullName: s.full_name }))
    );
    // Principal's own temporary-cover picker -- unlike SNA assignment,
    // not restricted to any one role, since access_tier is always 'sna'
    // regardless of who's granted (Step 0, #2) -- excludes the principal
    // themselves the same way GrantTemporaryAccessSheet's own RPC would
    // refuse a self-grant anyway, just surfaced earlier as a picker
    // filter rather than a runtime error.
    setEligibleStaffForCover(
      staffRoster.filter((s) => s.is_active).map((s) => ({ userId: s.user_id, fullName: s.full_name }))
    );
    const activeChildPassportIds = new Set(activeChildren.map((c) => c.passportId));
    setEligibleChildren(
      childRoster
        .filter((c) => !activeChildPassportIds.has(c.passport_id))
        .map((c) => ({ passportId: c.passport_id, childName: c.child_name }))
    );

    setIsLoading(false);
  }, [classId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady) {
    return null;
  }

  const slotsRemaining = 3 - teachers.active.length;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/classes"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">{className ?? "Class"}</h1>
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : (
          <>
            <section className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Teachers ({teachers.active.length}/3)
                </h2>
                <button
                  type="button"
                  onClick={() => setIsAddTeacherOpen(true)}
                  className="text-xs font-semibold text-brand-prussian-blue"
                >
                  + Add
                </button>
              </div>
              {teachers.active.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No teachers assigned yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {teachers.active.map((t) => (
                    <div key={t.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-brand-neutral-black">
                          {nameMap.get(t.userId) ?? "Unknown"}
                        </p>
                        <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
                          Active
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRemoveTeacherTarget(t)}
                        className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {teachers.removed.length > 0 && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowRemovedTeachers((v) => !v)}
                    className="flex w-full items-center justify-between rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50"
                  >
                    <span>Removed teachers ({teachers.removed.length})</span>
                    <span>{showRemovedTeachers ? "−" : "+"}</span>
                  </button>
                  {showRemovedTeachers && (
                    <div className="mt-2 flex flex-col gap-2">
                      {teachers.removed.map((t) => (
                        <div key={t.id} className="rounded-2xl border border-black/5 bg-white/60 p-4">
                          <p className="text-sm font-semibold text-brand-neutral-black">
                            {nameMap.get(t.userId) ?? "Unknown"}
                          </p>
                          <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                            Removed {formatDate(t.endedAt!)}
                            {t.endedByName ? ` by ${t.endedByName}` : ""}
                          </p>
                          {t.endReason && (
                            <p className="mt-2 text-sm text-brand-neutral-black/70">&ldquo;{t.endReason}&rdquo;</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Roster ({children.active.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setIsAddChildOpen(true)}
                  className="text-xs font-semibold text-brand-prussian-blue"
                >
                  + Add
                </button>
              </div>
              {children.active.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No children in this class yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {children.active.map((c) => {
                    const assignment = assignmentMap.get(c.passportId);
                    return (
                      <div key={c.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                        <p className="text-sm font-semibold text-brand-neutral-black">
                          {childNameMap.get(c.passportId) ?? "Unknown"}
                        </p>
                        <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                          {assignment ? `SNA: ${nameMap.get(assignment.snaUserId) ?? "Unknown"}` : "No SNA assigned"}
                        </p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setAssignSnaTarget(c)}
                            className="flex-1 rounded-xl border border-brand-prussian-blue py-2 text-center text-xs font-semibold text-brand-prussian-blue"
                          >
                            {assignment ? "Reassign SNA" : "Assign SNA"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoveChildTarget(c)}
                            className="flex-1 rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {children.removed.length > 0 && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowRemovedChildren((v) => !v)}
                    className="flex w-full items-center justify-between rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50"
                  >
                    <span>Previously in this class ({children.removed.length})</span>
                    <span>{showRemovedChildren ? "−" : "+"}</span>
                  </button>
                  {showRemovedChildren && (
                    <div className="mt-2 flex flex-col gap-2">
                      {children.removed.map((c) => (
                        <div key={c.id} className="rounded-2xl border border-black/5 bg-white/60 p-4">
                          <p className="text-sm font-semibold text-brand-neutral-black">
                            {childNameMap.get(c.passportId) ?? "Unknown"}
                          </p>
                          <p className="mt-0.5 text-xs text-brand-neutral-black/50">Left {formatDate(c.endedAt!)}</p>
                          {c.endReason && (
                            <p className="mt-2 text-sm text-brand-neutral-black/70">&ldquo;{c.endReason}&rdquo;</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Temporary Cover
                </h2>
                <button
                  type="button"
                  onClick={() => setIsGrantCoverOpen(true)}
                  className="text-xs font-semibold text-brand-prussian-blue"
                >
                  + Grant Cover
                </button>
              </div>
              {coverGrants.active.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No cover granted for this class.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {coverGrants.active.map((g) => (
                    <div key={g.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                      <p className="text-sm font-semibold text-brand-neutral-black">{nameMap.get(g.grantedTo) ?? "Unknown"}</p>
                      <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                        {g.grantedForDate === todayLocalDateString() ? "Today" : g.grantedForDate} · until {formatCutoffTime(cutoffTime)}
                      </p>
                      <p className="mt-1 text-sm text-brand-neutral-black/70">&ldquo;{g.reason}&rdquo;</p>
                      <button
                        type="button"
                        onClick={() => setRevokeCoverTarget(g)}
                        className="mt-2 block w-full rounded-xl border border-brand-golden-brown py-1.5 text-center text-xs font-semibold text-brand-golden-brown"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {coverGrants.past.length > 0 && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowCoverHistory((v) => !v)}
                    className="flex w-full items-center justify-between rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50"
                  >
                    <span>Past cover ({coverGrants.past.length})</span>
                    <span>{showCoverHistory ? "−" : "+"}</span>
                  </button>
                  {showCoverHistory && (
                    <div className="mt-2 flex flex-col gap-2">
                      {coverGrants.past.map((g) => (
                        <div key={g.id} className="rounded-2xl border border-black/5 bg-white/60 p-4">
                          <p className="text-sm font-semibold text-brand-neutral-black">{nameMap.get(g.grantedTo) ?? "Unknown"}</p>
                          <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                            {g.grantedForDate}
                            {g.revokedAt ? " · revoked early" : ""}
                          </p>
                          <p className="mt-1 text-sm text-brand-neutral-black/70">&ldquo;{g.reason}&rdquo;</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {institutionId && (
        <AddClassTeacherSheet
          isOpen={isAddTeacherOpen}
          classId={classId}
          className={className ?? "this class"}
          eligibleTeachers={eligibleTeachers}
          slotsRemaining={slotsRemaining}
          onClose={() => setIsAddTeacherOpen(false)}
          onAdded={() => {
            setIsAddTeacherOpen(false);
            load();
          }}
        />
      )}

      {institutionId && (
        <AddClassChildSheet
          isOpen={isAddChildOpen}
          classId={classId}
          className={className ?? "this class"}
          eligibleChildren={eligibleChildren}
          onClose={() => setIsAddChildOpen(false)}
          onAdded={() => {
            setIsAddChildOpen(false);
            load();
          }}
        />
      )}

      {removeTeacherTarget && (
        <ReasonConfirmSheet
          isOpen={Boolean(removeTeacherTarget)}
          title={`Remove ${nameMap.get(removeTeacherTarget.userId) ?? "this teacher"}?`}
          description="They lose access to this class's children through this class immediately. This is a removal, not a delete -- it stays in this class's history."
          confirmLabel="Remove Teacher"
          submittingLabel="Removing…"
          onClose={() => setRemoveTeacherTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error } = await supabase.rpc("remove_class_teacher", {
              p_class_teacher_id: removeTeacherTarget.id,
              p_reason: reason,
            });
            return { error: error?.message ?? null };
          }}
          onConfirmed={() => {
            setRemoveTeacherTarget(null);
            load();
          }}
        />
      )}

      {removeChildTarget && (
        <ReasonConfirmSheet
          isOpen={Boolean(removeChildTarget)}
          title={`Remove ${childNameMap.get(removeChildTarget.passportId) ?? "this child"} from ${className ?? "this class"}?`}
          description="They leave this class's roster immediately. This is a removal, not a delete -- it stays in this class's history. Any SNA assignment is unaffected -- that follows the child, not the class."
          confirmLabel="Remove Child"
          submittingLabel="Removing…"
          onClose={() => setRemoveChildTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error } = await supabase.rpc("remove_class_child", {
              p_class_children_id: removeChildTarget.id,
              p_reason: reason,
            });
            return { error: error?.message ?? null };
          }}
          onConfirmed={() => {
            setRemoveChildTarget(null);
            load();
          }}
        />
      )}

      {assignSnaTarget && institutionId && (
        <AssignSnaSheet
          isOpen={Boolean(assignSnaTarget)}
          passportId={assignSnaTarget.passportId}
          institutionId={institutionId}
          childName={childNameMap.get(assignSnaTarget.passportId) ?? "this child"}
          currentAssignment={
            assignmentMap.has(assignSnaTarget.passportId)
              ? {
                  id: assignmentMap.get(assignSnaTarget.passportId)!.id,
                  snaUserId: assignmentMap.get(assignSnaTarget.passportId)!.snaUserId,
                  snaName: nameMap.get(assignmentMap.get(assignSnaTarget.passportId)!.snaUserId) ?? "Unknown",
                }
              : null
          }
          eligibleSnas={eligibleSnas}
          onClose={() => setAssignSnaTarget(null)}
          onChanged={() => {
            setAssignSnaTarget(null);
            load();
          }}
        />
      )}

      {institutionId && (
        <GrantTemporaryAccessSheet
          isOpen={isGrantCoverOpen}
          mode="principal"
          classId={classId}
          className={className ?? "this class"}
          institutionId={institutionId}
          cutoffTime={cutoffTime}
          eligibleExisting={eligibleStaffForCover}
          onClose={() => setIsGrantCoverOpen(false)}
          onGranted={() => {
            setIsGrantCoverOpen(false);
            load();
          }}
        />
      )}

      {revokeCoverTarget && (
        <ReasonConfirmSheet
          isOpen={Boolean(revokeCoverTarget)}
          title={`Revoke ${nameMap.get(revokeCoverTarget.grantedTo) ?? "this"} cover?`}
          description="Their access for the rest of today ends immediately. This is a revocation, not a delete -- it stays in this class's cover history."
          confirmLabel="Revoke Cover"
          submittingLabel="Revoking…"
          onClose={() => setRevokeCoverTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error } = await supabase.rpc("revoke_temporary_access", {
              p_temporary_access_id: revokeCoverTarget.id,
              p_reason: reason,
            });
            return { error: error?.message ?? null };
          }}
          onConfirmed={() => {
            setRevokeCoverTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
