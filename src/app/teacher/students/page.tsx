"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTeacherPassports, type TeacherPassport } from "@/hooks/useTeacherPassports";
import { getChildDisplayName } from "@/lib/childDisplayName";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { PeopleIcon } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/client";

function getDiagnosisPills(diagnoses: string[] | null, diagnosisOther: string | null): string[] {
  if (!diagnoses || diagnoses.length === 0) return [];
  const hasOtherWithText = diagnoses.includes("Other") && Boolean(diagnosisOther);
  if (!hasOtherWithText) return diagnoses;
  const rest = diagnoses.filter((d) => d !== "Other");
  return [...rest, diagnosisOther as string];
}

function getInitials(firstName: string, childName: string): string {
  const parts = childName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return firstName[0]?.toUpperCase() ?? "?";
}

export default function TeacherStudentsPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("class_teacher");
  const {
    isLoading,
    error,
    passports,
    institutionId,
  } = useTeacherPassports(user?.id ?? null);

  const [query, setQuery] = useState("");

  // Stage 6, item 1 -- same "1:1 SNA: X" / "Class SNA: X, Y" / "No SNA
  // assigned" treatment as the principal's own ClassDetail.tsx and the
  // teacher's own My Class page, brought here too rather than left as
  // the one roster view with no SNA visibility at all. A separate,
  // page-local fetch -- useTeacherPassports() is shared by five other
  // surfaces (dashboard, ABC log picker, messages, morning grid,
  // morning-updates) that don't need this, so it isn't added there.
  const [snaLineByPassportId, setSnaLineByPassportId] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!institutionId || passports.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnaLineByPassportId(new Map());
      return;
    }
    let isMounted = true;
    async function load() {
      const supabase = createClient();
      const passportIds = passports.map((p) => p.passportId);

      const [assignmentsRes, classChildrenRes, staffRosterRes] = await Promise.all([
        supabase.from("child_assignments").select("passport_id, user_id").in("passport_id", passportIds).is("ended_at", null),
        supabase.from("class_children").select("passport_id, class_id").in("passport_id", passportIds).is("ended_at", null),
        supabase.rpc("get_institution_staff_roster", { p_institution_id: institutionId }),
      ]);
      if (!isMounted) return;

      const nameMap = new Map<string, string>(
        ((staffRosterRes.data ?? []) as { user_id: string; full_name: string }[]).map((s) => [s.user_id, s.full_name])
      );

      const classIdByPassportId = new Map<string, string>();
      for (const row of classChildrenRes.data ?? []) {
        classIdByPassportId.set(row.passport_id, row.class_id);
      }
      const classIds = [...new Set(classChildrenRes.data?.map((r) => r.class_id) ?? [])];

      const classSnaRes =
        classIds.length > 0
          ? await supabase.from("class_sna_assignments").select("class_id, user_id").in("class_id", classIds).is("ended_at", null)
          : { data: [] as { class_id: string; user_id: string }[] };
      if (!isMounted) return;

      const classSnaNamesByClassId = new Map<string, string[]>();
      for (const row of classSnaRes.data ?? []) {
        const list = classSnaNamesByClassId.get(row.class_id) ?? [];
        list.push(nameMap.get(row.user_id) ?? "Unknown");
        classSnaNamesByClassId.set(row.class_id, list);
      }

      const assignmentByPassportId = new Map<string, string>();
      for (const row of assignmentsRes.data ?? []) {
        assignmentByPassportId.set(row.passport_id, row.user_id);
      }

      const lines = new Map<string, string>();
      for (const passportId of passportIds) {
        const assignedSnaUserId = assignmentByPassportId.get(passportId);
        const classId = classIdByPassportId.get(passportId);
        const classSnaNames = classId ? classSnaNamesByClassId.get(classId) ?? [] : [];
        lines.set(
          passportId,
          assignedSnaUserId
            ? `1:1 SNA: ${nameMap.get(assignedSnaUserId) ?? "Unknown"}`
            : classSnaNames.length > 0
              ? `Class SNA: ${classSnaNames.join(", ")}`
              : "No SNA assigned"
        );
      }
      setSnaLineByPassportId(lines);
    }
    load();
    return () => {
      isMounted = false;
    };
    // passports is a fresh array reference each render (useTeacherPassports'
    // own return, not memoised) -- keyed on institutionId + the actual
    // passport id set, not the array reference, so this doesn't refetch
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId, passports.map((p) => p.passportId).join(",")]);

  const sorted = useMemo(
    () => [...passports].sort((a, b) => a.firstName.localeCompare(b.firstName)),
    [passports]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((p) => p.firstName.toLowerCase().includes(q));
  }, [sorted, query]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center justify-between gap-3 p-4">
        <h1 className="font-heading text-2xl text-brand-prussian-blue">My Students</h1>
      </header>

      <div className="sticky top-0 z-[1] bg-brand-off-white/40 px-4 pb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by first name"
          className="w-full rounded-xl border border-brand-off-white bg-white px-4 py-2 font-sans text-sm text-brand-neutral-black placeholder:text-brand-neutral-black/40 focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
      </div>

      <main className="flex-1">
        {isLoading ? (
          <div className="flex flex-col">
            {Array.from({ length: 6 }).map((_, i) => (
              <StudentRowSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="mx-4 rounded-xl border-2 border-dashed border-red-200 bg-white/60 p-6 text-center">
            <p className="font-sans text-sm text-red-600">{error}</p>
          </div>
        ) : passports.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 pt-10 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-pastel-blue/30 text-brand-prussian-blue">
              <PeopleIcon className="h-10 w-10" />
            </span>
            <p className="font-sans text-base font-bold text-brand-neutral-black">
              No students assigned yet.
            </p>
            <p className="max-w-[280px] font-sans text-sm text-brand-neutral-black/60">
              Ask your principal to add you to a class, or to grant you
              access to a specific child &mdash; either way, they&apos;ll
              appear here.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-4 pt-6 text-center font-sans text-sm text-brand-neutral-black/60">
            No students match &quot;{query}&quot;.
          </p>
        ) : (
          <div className="flex flex-col">
            {filtered.map((student) => (
              <StudentRow
                key={student.passportId}
                student={student}
                snaLine={snaLineByPassportId.get(student.passportId) ?? null}
                onTap={() => router.push(`/teacher/passport/${student.passportId}`)}
              />
            ))}
          </div>
        )}
      </main>

      <TeacherBottomNav />
    </div>
  );
}

function StudentRow({
  student,
  snaLine,
  onTap,
}: {
  student: TeacherPassport;
  snaLine: string | null;
  onTap: () => void;
}) {
  const pills = getDiagnosisPills(student.diagnoses, student.diagnosisOther);

  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center gap-4 border-b border-brand-off-white bg-white py-3 px-4 text-left last:border-b-0"
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-pastel-blue/30 font-heading font-bold text-brand-prussian-blue">
        {getInitials(student.firstName, student.childName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-base font-bold text-brand-neutral-black">
          {getChildDisplayName(student.childName)}
        </p>
        {snaLine && <p className="mt-0.5 text-xs text-brand-neutral-black/50">{snaLine}</p>}
        {pills.length > 0 && (
          <div className="mt-1 flex gap-1.5 overflow-x-auto scrollbar-hide">
            {pills.map((pill) => (
              <span
                key={pill}
                className="flex-shrink-0 whitespace-nowrap rounded-full bg-brand-off-white/50 px-2 py-0.5 text-[10px] uppercase text-brand-neutral-black/70"
              >
                {pill}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function StudentRowSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-4 border-b border-brand-off-white bg-white py-3 px-4 last:border-b-0">
      <span className="h-10 w-10 flex-shrink-0 rounded-full bg-black/10" />
      <div className="flex-1">
        <span className="block h-4 w-24 rounded bg-black/10" />
      </div>
    </div>
  );
}
