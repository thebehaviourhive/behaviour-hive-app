"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AddClassTeacherSheet } from "@/components/principal/AddClassTeacherSheet";
import { AddClassChildSheet } from "@/components/principal/AddClassChildSheet";
import { AssignClassSnaSheet } from "@/components/principal/AssignClassSnaSheet";
import { AssignSnaSheet } from "@/components/shared/AssignSnaSheet";
import { GrantTemporaryAccessSheet } from "@/components/shared/GrantTemporaryAccessSheet";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { formatTimeOfDay, todayLocalDateString } from "@/lib/temporaryAccessTime";

// PRD 1, Stage 2, Step 3. Principal's class detail: teachers (add/remove
// within the 3-slot cap), roster (add/remove a child), and per-child SNA
// assignment (assign/reassign, for ANY child at this school -- the
// principal branch of assign_sna_to_child() isn't scoped to this class).
//
// PRD 2, Stage 5 -- three real changes on top of the PRD 1 shape, plus
// a fourth genuinely new section:
//
// 1. "History is visible, not hidden" now gets the SAME first-class
//    header treatment Stage 4 established for Access History -- a
//    plain bold-uppercase section header with a +/- toggle, not the
//    old muted/dashed accordion-trigger box. Applied here to Previous
//    teachers, Previous class SNAs, and each child's own Assignment
//    History -- collapsed by default purely for density, never for
//    prominence. "Removed teachers"/"Previously in this class" renamed
//    to match Daniel's own wording ("Previous teachers").
//
// 2. Class SNA -- a genuinely new section (class_sna_assignments,
//    0129/0130), structurally identical to Teachers (add/remove with a
//    reason/Previous accordion) but with no slot cap -- Daniel's own
//    spec caps teachers at three and names nothing for SNAs.
//
// 3. Each active child's own SNA line now distinguishes CLASS SNA:
//    [name] from 1:1 SNA: [name] rather than a bare "SNA: [name]" --
//    1:1 takes display priority when both exist (it's the more
//    specific relationship); "No SNA assigned" only when neither does.
//
// 4. AddClassChildSheet's own eligibleChildren now comes from the
//    widened get_institution_child_roster()'s own current_class_id
//    column (0129), filtered to null -- genuinely enrolled-but-
//    unassigned, not "not already in THIS class" (which used to
//    silently offer moving a child out of another class as a side
//    effect of adding them here).
//
// Names are resolved via get_institution_staff_roster() (staff --
// covers every role, not just teachers, so class SNA names resolve
// from the same one fetch) and get_institution_child_roster()
// (children) -- the same two RPCs 0074 already built for exactly this
// "who is this person/child" problem, not a new lookup.
//
// PRD 4, Stage 4 -- extracted verbatim out of
// principal/classes/[classId]/page.tsx into its own component so the
// same detail can render both as that route's body (375px push-to-
// detail, unchanged) and as the Directory split view's right pane at
// 1280px (selection, no navigation). Takes className/onNameResolved
// instead of reading useParams() itself, and reports the resolved
// class name back up via onNameResolved so a route wrapper can put it
// in its own header -- this component itself renders no header/back-
// chevron, that's the caller's job in both contexts.

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

interface ClassSnaRow {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  endedByName: string | null;
  endReason: string | null;
}

interface Assignment {
  id: string;
  snaUserId: string;
}

interface AssignmentHistoryRow {
  id: string;
  snaUserId: string;
  startedAt: string;
  endedAt: string;
  endedByName: string | null;
  endReason: string | null;
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
  enrolment_ended_at: string | null;
  current_class_id: string | null;
}

interface CoverGrant {
  id: string;
  grantedTo: string;
  grantedForDate: string;
  reason: string;
  revokedAt: string | null;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function ClassDetail({
  classId,
  onNameResolved,
}: {
  classId: string;
  onNameResolved?: (name: string) => void;
}) {
  const [className, setClassName] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<{ active: TeacherRow[]; past: TeacherRow[] }>({ active: [], past: [] });
  const [classSnas, setClassSnas] = useState<{ active: ClassSnaRow[]; past: ClassSnaRow[] }>({ active: [], past: [] });
  const [children, setChildren] = useState<{ active: ChildRow[]; past: ChildRow[] }>({ active: [], past: [] });
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  const [childNameMap, setChildNameMap] = useState<Map<string, string>>(new Map());
  const [assignmentMap, setAssignmentMap] = useState<Map<string, Assignment>>(new Map());
  const [assignmentHistoryMap, setAssignmentHistoryMap] = useState<Map<string, AssignmentHistoryRow[]>>(new Map());
  const [eligibleTeachers, setEligibleTeachers] = useState<{ userId: string; fullName: string }[]>([]);
  const [eligibleClassSnas, setEligibleClassSnas] = useState<{ userId: string; fullName: string }[]>([]);
  const [eligibleSnas, setEligibleSnas] = useState<{ userId: string; fullName: string }[]>([]);
  const [eligibleChildren, setEligibleChildren] = useState<{ passportId: string; childName: string }[]>([]);
  const [eligibleStaffForCover, setEligibleStaffForCover] = useState<{ userId: string; fullName: string }[]>([]);
  const [startTime, setStartTime] = useState<string>("07:30:00");
  const [cutoffTime, setCutoffTime] = useState<string>("15:00:00");
  const [coverGrants, setCoverGrants] = useState<{ active: CoverGrant[]; past: CoverGrant[] }>({ active: [], past: [] });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPastTeachers, setShowPastTeachers] = useState(false);
  const [showPastClassSnas, setShowPastClassSnas] = useState(false);
  const [showPastChildren, setShowPastChildren] = useState(false);
  const [showCoverHistory, setShowCoverHistory] = useState(false);
  const [expandedHistoryFor, setExpandedHistoryFor] = useState<Set<string>>(new Set());

  const [isAddTeacherOpen, setIsAddTeacherOpen] = useState(false);
  const [isAddChildOpen, setIsAddChildOpen] = useState(false);
  const [isAssignClassSnaOpen, setIsAssignClassSnaOpen] = useState(false);
  const [isGrantCoverOpen, setIsGrantCoverOpen] = useState(false);
  const [removeTeacherTarget, setRemoveTeacherTarget] = useState<TeacherRow | null>(null);
  const [removeChildTarget, setRemoveChildTarget] = useState<ChildRow | null>(null);
  const [removeClassSnaTarget, setRemoveClassSnaTarget] = useState<ClassSnaRow | null>(null);
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
    onNameResolved?.(classRow.name);
    setInstitutionId(classRow.institution_id);

    const [teacherRowsResult, classSnaRowsResult, childRowsResult, staffRosterResult, childRosterResult, instResult, coverResult] =
      await Promise.all([
        supabase
          .from("class_teachers")
          .select("id, user_id, position, started_at, ended_at, ended_by, end_reason")
          .eq("class_id", classId)
          .order("position"),
        supabase
          .from("class_sna_assignments")
          .select("id, user_id, started_at, ended_at, ended_by, end_reason")
          .eq("class_id", classId)
          .order("started_at"),
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
        supabase.from("institutions").select("temporary_access_start_time, temporary_access_cutoff_time").eq("id", classRow.institution_id).single(),
        supabase
          .from("temporary_access")
          .select("id, granted_to, granted_for_date, reason, revoked_at")
          .eq("class_id", classId)
          .order("granted_for_date", { ascending: false }),
      ]);

    if (instResult.data?.temporary_access_start_time) {
      setStartTime(instResult.data.temporary_access_start_time);
    }
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
    const pastTeachers: TeacherRow[] = [];
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
      (t.ended_at ? pastTeachers : activeTeachers).push(row);
    }
    setTeachers({ active: activeTeachers, past: pastTeachers });

    const activeClassSnas: ClassSnaRow[] = [];
    const pastClassSnas: ClassSnaRow[] = [];
    for (const s of classSnaRowsResult.data ?? []) {
      const row: ClassSnaRow = {
        id: s.id,
        userId: s.user_id,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        endedByName: s.ended_by ? (names.get(s.ended_by) ?? null) : null,
        endReason: s.end_reason,
      };
      (s.ended_at ? pastClassSnas : activeClassSnas).push(row);
    }
    setClassSnas({ active: activeClassSnas, past: pastClassSnas });

    const activeChildren: ChildRow[] = [];
    const pastChildren: ChildRow[] = [];
    for (const c of childRowsResult.data ?? []) {
      const row: ChildRow = {
        id: c.id,
        passportId: c.passport_id,
        startedAt: c.started_at,
        endedAt: c.ended_at,
        endReason: c.end_reason,
      };
      (c.ended_at ? pastChildren : activeChildren).push(row);
    }
    setChildren({ active: activeChildren, past: pastChildren });

    // Every child_assignments row (active AND past) for this class's
    // own currently-active children, one query -- an institution-wide
    // table, so this filters explicitly to this class's passport ids
    // rather than relying on class membership to scope it, matching
    // child_assignments' own RLS (institution-wide, not class-scoped).
    const activePassportIds = activeChildren.map((c) => c.passportId);
    if (activePassportIds.length > 0) {
      const { data: assignmentRows } = await supabase
        .from("child_assignments")
        .select("id, passport_id, user_id, started_at, ended_at, ended_by, end_reason")
        .in("passport_id", activePassportIds)
        .order("started_at", { ascending: false });
      const assignments = new Map<string, Assignment>();
      const history = new Map<string, AssignmentHistoryRow[]>();
      for (const a of assignmentRows ?? []) {
        if (!a.ended_at) {
          assignments.set(a.passport_id, { id: a.id, snaUserId: a.user_id });
        } else {
          const row: AssignmentHistoryRow = {
            id: a.id,
            snaUserId: a.user_id,
            startedAt: a.started_at,
            endedAt: a.ended_at,
            endedByName: a.ended_by ? (names.get(a.ended_by) ?? null) : null,
            endReason: a.end_reason,
          };
          history.set(a.passport_id, [...(history.get(a.passport_id) ?? []), row]);
        }
      }
      setAssignmentMap(assignments);
      setAssignmentHistoryMap(history);
    } else {
      setAssignmentMap(new Map());
      setAssignmentHistoryMap(new Map());
    }

    const activeTeacherUserIds = new Set(activeTeachers.map((t) => t.userId));
    setEligibleTeachers(
      staffRoster
        .filter((s) => s.role === "class_teacher" && s.is_active && !activeTeacherUserIds.has(s.user_id))
        .map((s) => ({ userId: s.user_id, fullName: s.full_name }))
    );
    const activeClassSnaUserIds = new Set(activeClassSnas.map((s) => s.userId));
    setEligibleClassSnas(
      staffRoster
        .filter((s) => s.role === "sna" && s.is_active && !activeClassSnaUserIds.has(s.user_id))
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
    // Stage 5: genuinely enrolled-but-unassigned only (current_class_id
    // is null), via the widened roster's own new column -- not "not
    // already in THIS class", which used to also offer a silent move
    // out of another class. Departed children excluded too (a real
    // correctness fix while rewriting this, not something the old
    // filter checked at all).
    setEligibleChildren(
      childRoster
        .filter((c) => !c.enrolment_ended_at && c.current_class_id === null)
        .map((c) => ({ passportId: c.passport_id, childName: c.child_name }))
    );

    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function toggleHistory(passportId: string) {
    setExpandedHistoryFor((prev) => {
      const next = new Set(prev);
      if (next.has(passportId)) {
        next.delete(passportId);
      } else {
        next.add(passportId);
      }
      return next;
    });
  }

  const slotsRemaining = 3 - teachers.active.length;

  return (
    <>
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

            {/* Stage 4's own correction, applied here too: same
                header weight as the section above it, not a muted
                footnote. Collapsed by default for density only. */}
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowPastTeachers((v) => !v)}
                className="mb-2 flex w-full items-center justify-between"
              >
                <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Previous Teachers ({teachers.past.length})
                </h2>
                <span className="text-sm font-semibold text-brand-neutral-black/40">{showPastTeachers ? "−" : "+"}</span>
              </button>
              {showPastTeachers && (
                teachers.past.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                    No previous teachers.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {teachers.past.map((t) => (
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
                )
              )}
            </div>
          </section>

          <section className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                Class SNA ({classSnas.active.length})
              </h2>
              <button
                type="button"
                onClick={() => setIsAssignClassSnaOpen(true)}
                className="text-xs font-semibold text-brand-prussian-blue"
              >
                + Assign
              </button>
            </div>
            {classSnas.active.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                No class SNA assigned. A class SNA sees everything for every child here -- for day-scoped cover
                instead, use Temporary Cover below.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {classSnas.active.map((s) => (
                  <div key={s.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-brand-neutral-black">
                        {nameMap.get(s.userId) ?? "Unknown"}
                      </p>
                      <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
                        Active
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRemoveClassSnaTarget(s)}
                      className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowPastClassSnas((v) => !v)}
                className="mb-2 flex w-full items-center justify-between"
              >
                <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Previous Class SNAs ({classSnas.past.length})
                </h2>
                <span className="text-sm font-semibold text-brand-neutral-black/40">{showPastClassSnas ? "−" : "+"}</span>
              </button>
              {showPastClassSnas && (
                classSnas.past.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                    No previous class SNAs.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {classSnas.past.map((s) => (
                      <div key={s.id} className="rounded-2xl border border-black/5 bg-white/60 p-4">
                        <p className="text-sm font-semibold text-brand-neutral-black">
                          {nameMap.get(s.userId) ?? "Unknown"}
                        </p>
                        <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                          Removed {formatDate(s.endedAt!)}
                          {s.endedByName ? ` by ${s.endedByName}` : ""}
                        </p>
                        {s.endReason && (
                          <p className="mt-2 text-sm text-brand-neutral-black/70">&ldquo;{s.endReason}&rdquo;</p>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
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
                  const history = assignmentHistoryMap.get(c.passportId) ?? [];
                  const classSnaNames = classSnas.active.map((s) => nameMap.get(s.userId) ?? "Unknown");
                  const snaLine = assignment
                    ? `1:1 SNA: ${nameMap.get(assignment.snaUserId) ?? "Unknown"}`
                    : classSnaNames.length > 0
                      ? `Class SNA: ${classSnaNames.join(", ")}`
                      : "No SNA assigned";
                  const isHistoryOpen = expandedHistoryFor.has(c.passportId);
                  return (
                    <div key={c.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                      <p className="text-sm font-semibold text-brand-neutral-black">
                        {childNameMap.get(c.passportId) ?? "Unknown"}
                      </p>
                      <p className="mt-0.5 text-xs text-brand-neutral-black/50">{snaLine}</p>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAssignSnaTarget(c)}
                          className="flex-1 rounded-xl border border-brand-prussian-blue py-2 text-center text-xs font-semibold text-brand-prussian-blue"
                        >
                          {assignment ? "Reassign 1:1 SNA" : "Assign 1:1 SNA"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemoveChildTarget(c)}
                          className="flex-1 rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
                        >
                          Remove
                        </button>
                      </div>

                      {history.length > 0 && (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => toggleHistory(c.passportId)}
                            className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50"
                          >
                            <span>Assignment History ({history.length})</span>
                            <span>{isHistoryOpen ? "−" : "+"}</span>
                          </button>
                          {isHistoryOpen && (
                            <div className="mt-2 flex flex-col gap-2">
                              {history.map((h) => (
                                <div key={h.id} className="rounded-xl border border-black/5 bg-brand-off-white/40 p-3">
                                  <p className="text-xs font-semibold text-brand-neutral-black">
                                    {nameMap.get(h.snaUserId) ?? "Unknown"}
                                  </p>
                                  <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                                    {formatDate(h.startedAt)} – {formatDate(h.endedAt)}
                                    {h.endedByName ? ` · ended by ${h.endedByName}` : ""}
                                  </p>
                                  {h.endReason && (
                                    <p className="mt-1 text-xs text-brand-neutral-black/70">&ldquo;{h.endReason}&rdquo;</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowPastChildren((v) => !v)}
                className="mb-2 flex w-full items-center justify-between"
              >
                <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Previously in this Class ({children.past.length})
                </h2>
                <span className="text-sm font-semibold text-brand-neutral-black/40">{showPastChildren ? "−" : "+"}</span>
              </button>
              {showPastChildren && (
                children.past.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                    No children have left this class.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {children.past.map((c) => (
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
                )
              )}
            </div>
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
                      {g.grantedForDate === todayLocalDateString() ? "Today" : g.grantedForDate} · until {formatTimeOfDay(cutoffTime)}
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
        <AssignClassSnaSheet
          isOpen={isAssignClassSnaOpen}
          classId={classId}
          className={className ?? "this class"}
          eligibleSnas={eligibleClassSnas}
          onClose={() => setIsAssignClassSnaOpen(false)}
          onAssigned={() => {
            setIsAssignClassSnaOpen(false);
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

      {removeClassSnaTarget && (
        <ReasonConfirmSheet
          isOpen={Boolean(removeClassSnaTarget)}
          title={`Remove ${nameMap.get(removeClassSnaTarget.userId) ?? "this class SNA"}?`}
          description="They lose class-wide access to this class's children immediately. This is a removal, not a delete -- it stays in this class's history."
          confirmLabel="Remove Class SNA"
          submittingLabel="Removing…"
          onClose={() => setRemoveClassSnaTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error } = await supabase.rpc("end_class_sna_assignment", {
              p_class_sna_assignment_id: removeClassSnaTarget.id,
              p_reason: reason,
            });
            return { error: error?.message ?? null };
          }}
          onConfirmed={() => {
            setRemoveClassSnaTarget(null);
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
          startTime={startTime}
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
    </>
  );
}
