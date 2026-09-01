"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTeacherPassports, type TeacherPassport } from "@/hooks/useTeacherPassports";
import { getChildDisplayName } from "@/lib/childDisplayName";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { PeopleIcon } from "@/components/ui/icons";

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
  } = useTeacherPassports(user?.id ?? null);

  const [query, setQuery] = useState("");

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

function StudentRow({ student, onTap }: { student: TeacherPassport; onTap: () => void }) {
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
