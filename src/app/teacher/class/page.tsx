"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { AssignSnaSheet } from "@/components/shared/AssignSnaSheet";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { PeopleIcon } from "@/components/ui/icons";

// PRD 1, Stage 2, Step 3. A class teacher's own class(es) -- roster
// (read-only: adding/removing a CHILD is principal-only, per Step 0's
// answer) and SNA assignment WITHIN their own class only, never another
// -- assign_sna_to_child()'s own delegated-authority branch is the real
// boundary; this page only ever queries/acts on classes this session's
// own class_teachers rows say are current.
//
// A teacher can teach more than one class -- nothing in this schema
// caps that -- so this resolves to a LIST of active classes, not a
// single one.
//
// THE DESIGN DECISION Daniel asked for named explicitly: this page
// re-resolves "which classes am I currently teaching" from class_teachers
// fresh on every load, exactly the way /principal/dashboard's own
// ROLE_MISMATCH handling re-resolves institution_staff fresh rather than
// trusting anything cached from an earlier visit. A teacher removed from
// a class mid-day (or a class emptied of all its teachers) does not see
// a blank "no classes" screen indistinguishable from having never taught
// one -- the empty state below says so explicitly, the same honesty
// principle as the deactivated-person redirect. What this does NOT
// cover, named rather than silently assumed: a write already in flight
// in the few seconds between removal and submission -- that is refused
// at the database layer regardless (has_class_teacher_access() re-checks
// institution_staff independently of this page's own cache, confirmed
// live by CHECK Y-cascade-3), the same defense-in-depth boundary that
// protects everything else in this stage; the failure just surfaces as
// the RPC's own error text in that rare window, not a bespoke message.

interface MyClass {
  id: string;
  name: string;
}

interface RosterChild {
  passportId: string;
  childName: string;
  classId: string;
  className: string;
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

export default function TeacherClassPage() {
  const { user, isReady } = useRequireRole("class_teacher");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [myClasses, setMyClasses] = useState<MyClass[]>([]);
  const [roster, setRoster] = useState<RosterChild[]>([]);
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  const [assignmentMap, setAssignmentMap] = useState<Map<string, Assignment>>(new Map());
  const [eligibleSnas, setEligibleSnas] = useState<{ userId: string; fullName: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignSnaTarget, setAssignSnaTarget] = useState<RosterChild | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "class_teacher")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      setError("Could not find your school.");
      setIsLoading(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    // Fresh, every load -- never trusted from an earlier visit. Empty
    // here means "not currently teaching a class", which the empty
    // state below says explicitly rather than leaving ambiguous.
    const { data: activeTeacherRows } = await supabase
      .from("class_teachers")
      .select("class_id")
      .eq("user_id", user.id)
      .is("ended_at", null);

    const classIds = [...new Set((activeTeacherRows ?? []).map((r) => r.class_id))];
    if (classIds.length === 0) {
      setMyClasses([]);
      setRoster([]);
      setIsLoading(false);
      return;
    }

    const [classRowsResult, childRowsResult, staffRosterResult, childRosterResult] = await Promise.all([
      supabase.from("classes").select("id, name").in("id", classIds),
      supabase.from("class_children").select("passport_id, class_id").in("class_id", classIds).is("ended_at", null),
      supabase.rpc("get_institution_staff_roster", { p_institution_id: staffRow.institution_id }),
      supabase.rpc("get_institution_child_roster", { p_institution_id: staffRow.institution_id }),
    ]);

    const staffRoster = (staffRosterResult.data ?? []) as StaffRosterRow[];
    const childRoster = (childRosterResult.data ?? []) as ChildRosterRow[];

    const classes = (classRowsResult.data ?? []).map((c) => ({ id: c.id, name: c.name }));
    setMyClasses(classes);
    const classNameById = new Map(classes.map((c) => [c.id, c.name]));

    const childNames = new Map<string, string>();
    for (const c of childRoster) {
      childNames.set(c.passport_id, c.child_name);
    }

    const rosterRows: RosterChild[] = (childRowsResult.data ?? []).map((r) => ({
      passportId: r.passport_id,
      childName: childNames.get(r.passport_id) ?? "Unknown",
      classId: r.class_id,
      className: classNameById.get(r.class_id) ?? "Unknown",
    }));
    setRoster(rosterRows);

    const names = new Map<string, string>();
    for (const s of staffRoster) {
      names.set(s.user_id, s.full_name);
    }
    setNameMap(names);
    setEligibleSnas(
      staffRoster
        .filter((s) => s.role === "sna" && s.is_active)
        .map((s) => ({ userId: s.user_id, fullName: s.full_name }))
    );

    const passportIds = rosterRows.map((r) => r.passportId);
    if (passportIds.length > 0) {
      const { data: assignmentRows } = await supabase
        .from("child_assignments")
        .select("id, passport_id, user_id")
        .in("passport_id", passportIds)
        .is("ended_at", null);
      const assignments = new Map<string, Assignment>();
      for (const a of assignmentRows ?? []) {
        assignments.set(a.passport_id, { id: a.id, snaUserId: a.user_id });
      }
      setAssignmentMap(assignments);
    } else {
      setAssignmentMap(new Map());
    }

    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="p-4">
        <h1 className="font-heading text-2xl text-brand-prussian-blue">My Class</h1>
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : myClasses.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-10 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-pastel-blue/30 text-brand-prussian-blue">
              <PeopleIcon className="h-10 w-10" />
            </span>
            <p className="font-sans text-base font-bold text-brand-neutral-black">
              You&apos;re not currently teaching a class.
            </p>
            <p className="max-w-[280px] font-sans text-sm text-brand-neutral-black/60">
              If you were teaching one earlier and no longer see it here, your school&apos;s principal has changed
              your class -- this isn&apos;t an error.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {myClasses.map((cls) => {
              const classRoster = roster.filter((r) => r.classId === cls.id);
              return (
                <section key={cls.id}>
                  <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                    {cls.name} ({classRoster.length})
                  </h2>
                  {classRoster.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                      No children in this class yet.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {classRoster.map((c) => {
                        const assignment = assignmentMap.get(c.passportId);
                        return (
                          <div key={c.passportId} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                            <p className="text-sm font-semibold text-brand-neutral-black">{c.childName}</p>
                            <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                              {assignment ? `SNA: ${nameMap.get(assignment.snaUserId) ?? "Unknown"}` : "No SNA assigned"}
                            </p>
                            <button
                              type="button"
                              onClick={() => setAssignSnaTarget(c)}
                              className="mt-3 block w-full rounded-xl border border-brand-prussian-blue py-2 text-center text-xs font-semibold text-brand-prussian-blue"
                            >
                              {assignment ? "Reassign SNA" : "Assign SNA"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>

      {assignSnaTarget && institutionId && (
        <AssignSnaSheet
          isOpen={Boolean(assignSnaTarget)}
          passportId={assignSnaTarget.passportId}
          institutionId={institutionId}
          childName={assignSnaTarget.childName}
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

      <TeacherBottomNav />
    </div>
  );
}
