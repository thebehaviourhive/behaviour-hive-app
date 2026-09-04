import type { SupabaseClient } from "@supabase/supabase-js";

// Shared resolver for "which of my children still need an end-of-day
// update today" -- used by both the dashboard card (count only) and the
// bulk walk-through itself (the full queue). One implementation,
// deliberately, so the dashboard's own gate can never drift from what
// the bulk flow actually finds when it loads a moment later -- the
// dashboard card promising N remaining and the bulk flow then finding a
// different N would be the exact "operation that reports one thing and
// does another" shape this codebase has already been burned by more
// than once.
//
// "Remaining" = a roster child with no teacher_updates row yet today,
// for THIS teacher. A marked_absent row (0167) counts as done, for
// free -- it's a real row in the same table, no separate check needed.

export interface TeacherEodQueueChild {
  passportId: string;
  childName: string;
  classId: string;
  className: string;
}

interface ChildRosterRow {
  passport_id: string;
  child_name: string;
}

export async function resolveTeacherEodQueue(
  supabase: SupabaseClient,
  userId: string
): Promise<TeacherEodQueueChild[]> {
  const { data: staffRow } = await supabase
    .from("institution_staff")
    .select("institution_id")
    .eq("user_id", userId)
    .eq("role", "class_teacher")
    .is("deactivated_at", null)
    .not("approved_at", "is", null)
    .maybeSingle();

  if (!staffRow) return [];

  const { data: activeTeacherRows } = await supabase
    .from("class_teachers")
    .select("class_id")
    .eq("user_id", userId)
    .is("ended_at", null);

  const classIds = [...new Set((activeTeacherRows ?? []).map((r) => r.class_id as string))];
  if (classIds.length === 0) return [];

  const [classRowsResult, childRowsResult, childRosterResult] = await Promise.all([
    supabase.from("classes").select("id, name").in("id", classIds),
    supabase.from("class_children").select("passport_id, class_id").in("class_id", classIds).is("ended_at", null),
    supabase.rpc("get_institution_child_roster", { p_institution_id: staffRow.institution_id }),
  ]);

  const classNameById = new Map((classRowsResult.data ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
  const childNameById = new Map(
    ((childRosterResult.data ?? []) as ChildRosterRow[]).map((c) => [c.passport_id, c.child_name])
  );

  const allChildren: TeacherEodQueueChild[] = (childRowsResult.data ?? []).map(
    (r: { passport_id: string; class_id: string }) => ({
      passportId: r.passport_id,
      childName: childNameById.get(r.passport_id) ?? "Unknown",
      classId: r.class_id,
      className: classNameById.get(r.class_id) ?? "Unknown",
    })
  );

  if (allChildren.length === 0) return [];

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const passportIds = allChildren.map((c) => c.passportId);
  const { data: doneRows } = await supabase
    .from("teacher_updates")
    .select("passport_id")
    .eq("teacher_id", userId)
    .in("passport_id", passportIds)
    .gte("submitted_at", startOfToday.toISOString());
  const doneSet = new Set((doneRows ?? []).map((r: { passport_id: string }) => r.passport_id));

  return allChildren.filter((c) => !doneSet.has(c.passportId));
}
