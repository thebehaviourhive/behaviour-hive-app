"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getChildDisplayName, getChildFirstName } from "@/lib/childDisplayName";
import { getRagStatus, RAG_BADGE, RAG_TIER_ORDER, type RagStatus } from "@/lib/ragStatus";
import { AddChildSheet } from "@/components/teacher/AddChildSheet";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";

type RagCheckinState = "settled" | "unsettled" | "dysregulated" | null;
type RagCheckinSleep = "slept_through" | "woke_briefly" | "very_restless" | "barely_slept" | null;

interface StudentCardData {
  passportId: string;
  displayName: string;
  firstName: string;
  rag: RagStatus;
  headsUp: string | null;
  hasSubmittedEodToday: boolean;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Welcome back";
}

export default function TeacherDashboardPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("class_teacher");

  const [firstName, setFirstName] = useState("there");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [institutionCode, setInstitutionCode] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentCardData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddChildOpen, setIsAddChildOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!user) return;

    const fullName = user.user_metadata?.full_name as string | undefined;
    if (fullName) {
      setFirstName(fullName.split(" ")[0]);
    }

    let isMounted = true;

    async function load() {
      const supabase = createClient();

      const { data: staffRow } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!isMounted) return;

      if (!staffRow) {
        router.replace("/teacher/join-institution");
        return;
      }

      setInstitutionId(staffRow.institution_id);

      const { data: institutionRow } = await supabase
        .from("institutions")
        .select("institution_code")
        .eq("id", staffRow.institution_id)
        .maybeSingle();

      if (!isMounted) return;
      setInstitutionCode(institutionRow?.institution_code ?? null);

      const { data: accessRows } = await supabase
        .from("passport_access")
        .select("passport_id, institution_id")
        .eq("teacher_id", user!.id)
        .eq("is_active", true);

      if (!isMounted) return;

      const candidatePassportIds = Array.from(
        new Set((accessRows ?? []).map((row) => row.passport_id))
      );

      if (candidatePassportIds.length === 0) {
        setStudents([]);
        setIsLoading(false);
        return;
      }

      // A passport_access row alone isn't enough — the parent's approval
      // (passport_institution_links.approved_by_parent) must still be in
      // place too. Revoking either side must drop the child from view.
      const { data: linkRows } = await supabase
        .from("passport_institution_links")
        .select("passport_id, institution_id")
        .in("passport_id", candidatePassportIds)
        .eq("approved_by_parent", true);

      if (!isMounted) return;

      const approvedPairs = new Set(
        (linkRows ?? []).map((row) => `${row.passport_id}|${row.institution_id}`)
      );

      const passportIds = (accessRows ?? [])
        .filter((row) => approvedPairs.has(`${row.passport_id}|${row.institution_id}`))
        .map((row) => row.passport_id);

      if (passportIds.length === 0) {
        setStudents([]);
        setIsLoading(false);
        return;
      }

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [{ data: passportRows }, { data: checkinRows }, { data: updateRows }] =
        await Promise.all([
          supabase.from("passports").select("id, child_name").in("id", passportIds),
          supabase
            .from("morning_checkins")
            .select("passport_id, sleep_quality, regulation_state, heads_up, checked_in_at")
            .in("passport_id", passportIds)
            .gte("checked_in_at", startOfToday.toISOString())
            .order("checked_in_at", { ascending: false }),
          supabase
            .from("teacher_updates")
            .select("passport_id")
            .eq("teacher_id", user!.id)
            .in("passport_id", passportIds)
            .gte("submitted_at", startOfToday.toISOString()),
        ]);

      if (!isMounted) return;

      // Most recent check-in wins if a child somehow has more than one row
      // for today — rows are already ordered newest first.
      const checkinByPassport = new Map<
        string,
        { sleep_quality: string | null; regulation_state: string | null; heads_up: string | null }
      >();
      for (const row of checkinRows ?? []) {
        if (!checkinByPassport.has(row.passport_id)) {
          checkinByPassport.set(row.passport_id, row);
        }
      }

      const updatedPassportIds = new Set((updateRows ?? []).map((row) => row.passport_id));

      const cards: StudentCardData[] = (passportRows ?? []).map((passport) => {
        const checkin = checkinByPassport.get(passport.id) ?? null;
        return {
          passportId: passport.id,
          displayName: getChildDisplayName(passport.child_name),
          firstName: getChildFirstName(passport.child_name),
          rag: getRagStatus(
            checkin
              ? {
                  regulationState: checkin.regulation_state as RagCheckinState,
                  sleepQuality: checkin.sleep_quality as RagCheckinSleep,
                }
              : null
          ),
          headsUp: checkin?.heads_up ?? null,
          hasSubmittedEodToday: updatedPassportIds.has(passport.id),
        };
      });

      cards.sort((a, b) => {
        const tierDiff = RAG_TIER_ORDER[a.rag] - RAG_TIER_ORDER[b.rag];
        if (tierDiff !== 0) return tierDiff;
        return a.firstName.localeCompare(b.firstName);
      });

      setStudents(cards);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, router, refreshKey]);

  if (!isReady || isLoading) {
    return null;
  }

  const isAfternoon = new Date().getHours() >= 13;
  const hasStudents = students.length > 0;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-safe-ivory/40 pb-24">
      <header className="flex items-start justify-between gap-3 px-4 pt-8 pb-2">
        <div>
          {hasStudents ? (
            <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
              {getGreeting()}, {firstName}
            </h1>
          ) : (
            <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
              Welcome to your Hive Dashboard!
            </h1>
          )}
        </div>
        {hasStudents && (
          <button
            type="button"
            onClick={() => setIsAddChildOpen(true)}
            aria-label="Add a child"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-prussian-blue text-lg text-white shadow-sm"
          >
            +
          </button>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-2">
        {hasStudents ? (
          students.map((student) => (
            <StudentCard
              key={student.passportId}
              student={student}
              isAfternoon={isAfternoon}
              onOpenProfile={() => router.push(`/teacher/passport/${student.passportId}`)}
              onStartEod={() => router.push(`/teacher/eod/${student.passportId}`)}
            />
          ))
        ) : (
          <EmptyState
            institutionCode={institutionCode}
            onAddChild={() => setIsAddChildOpen(true)}
          />
        )}
      </main>

      {institutionId && (
        <AddChildSheet
          isOpen={isAddChildOpen}
          onClose={() => setIsAddChildOpen(false)}
          teacherId={user!.id}
          institutionId={institutionId}
          institutionCode={institutionCode}
          onAdded={() => setRefreshKey((k) => k + 1)}
        />
      )}
      <TeacherBottomNav active="dashboard" />
    </div>
  );
}

function EmptyState({
  institutionCode,
  onAddChild,
}: {
  institutionCode: string | null;
  onAddChild: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!institutionCode) return;
    navigator.clipboard.writeText(institutionCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-1 flex-col items-center pt-4 text-center">
      <p className="mb-6 text-sm leading-relaxed text-black/60">
        This is where you will see your students&apos; daily check-ins. Your
        dashboard is currently empty.
      </p>

      <div className="w-full rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40">
          Your Institution Code
        </p>
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-dashed border-brand-prussian-blue/30 bg-brand-pastel-blue/10 px-5 py-4">
          <span className="font-heading text-2xl font-bold tracking-[0.2em] text-brand-prussian-blue">
            {institutionCode ?? "——————"}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!institutionCode}
            className="rounded-full bg-brand-prussian-blue px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {copied ? "Copied!" : "Copy Code"}
          </button>
        </div>
        <p className="text-sm leading-relaxed text-black/60">
          Share this unique Institution Code with parents. Once they link
          their child&apos;s passport to this code, they will appear right
          here.
        </p>
      </div>

      <button
        type="button"
        onClick={onAddChild}
        className="mt-6 w-full rounded-2xl bg-brand-golden-brown py-3.5 text-base font-semibold text-white shadow-sm"
      >
        Add Child
      </button>
    </div>
  );
}

function StudentCard({
  student,
  isAfternoon,
  onOpenProfile,
  onStartEod,
}: {
  student: StudentCardData;
  isAfternoon: boolean;
  onOpenProfile: () => void;
  onStartEod: () => void;
}) {
  const badge = RAG_BADGE[student.rag];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenProfile}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpenProfile();
      }}
      className={`cursor-pointer rounded-2xl border-l-4 bg-white p-4 shadow-sm transition-transform active:scale-[0.99] ${badge.borderClass}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-semibold text-brand-neutral-black">
          {student.displayName}
        </p>
        <span
          className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.badgeClass}`}
        >
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${badge.dotClass}`} />
          {badge.label}
        </span>
      </div>

      {student.headsUp && (
        <div className="relative mt-3 rounded-xl bg-brand-safe-ivory/40 py-2.5 pl-9 pr-3">
          <span aria-hidden className="absolute left-2.5 top-2.5 text-sm leading-none">
            💬
          </span>
          <p className="text-xs italic text-brand-neutral-black/80">{student.headsUp}</p>
        </div>
      )}

      {isAfternoon && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!student.hasSubmittedEodToday) onStartEod();
          }}
          disabled={student.hasSubmittedEodToday}
          className={`mt-3 w-full rounded-full py-2.5 text-sm font-semibold transition-colors ${
            student.hasSubmittedEodToday
              ? "cursor-not-allowed bg-black/5 text-black/40"
              : "bg-brand-golden-brown text-white"
          }`}
        >
          {student.hasSubmittedEodToday ? "Update Sent" : "Complete EOD Update"}
        </button>
      )}
    </div>
  );
}
