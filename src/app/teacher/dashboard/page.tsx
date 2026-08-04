"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTeacherPassports } from "@/hooks/useTeacherPassports";
import { useTeacherMorningCheckins, type MorningPupilStatus } from "@/hooks/useTeacherMorningCheckins";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { AddChildSheet } from "@/components/teacher/AddChildSheet";
import { MorningPupilCard, MorningPupilCardSkeleton } from "@/components/teacher/MorningPupilCard";
import { MorningCheckinDetailSheet } from "@/components/teacher/MorningCheckinDetailSheet";
import { TeacherQuickActions } from "@/components/teacher/TeacherQuickActions";
import { TeacherActivityCard } from "@/components/teacher/TeacherActivityCard";

const GRID_CAP = 6;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function TeacherDashboardPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("class_teacher");

  const [isAddChildOpen, setIsAddChildOpen] = useState(false);
  const [selectedPupil, setSelectedPupil] = useState<MorningPupilStatus | null>(null);

  const {
    isLoading: isLoadingPassports,
    institutionId,
    institutionCode,
    passports,
    refresh,
  } = useTeacherPassports(user?.id ?? null);

  const { isLoading: isLoadingCheckins, pupils, redAlertCount } = useTeacherMorningCheckins(
    user?.id ?? null
  );

  const teacherFullName = user?.user_metadata?.full_name as string | undefined;
  const firstName = teacherFullName ? teacherFullName.split(" ")[0] : "there";

  useEffect(() => {
    if (!isReady || isLoadingPassports) return;
    if (institutionId === null) router.replace("/teacher/join-institution");
  }, [isReady, isLoadingPassports, institutionId, router]);

  if (!isReady || isLoadingPassports || institutionId === null) {
    return null;
  }

  const hasStudents = passports.length > 0;
  const gridPupils = pupils.slice(0, GRID_CAP);
  const overflowCount = pupils.length - GRID_CAP;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <h1 className="mt-6 px-4 font-heading text-2xl font-bold text-brand-prussian-blue">
        {getGreeting()}, {firstName}
      </h1>

      {!hasStudents ? (
        <EmptyState
          institutionCode={institutionCode}
          onAddChild={() => setIsAddChildOpen(true)}
        />
      ) : (
        <>
          <div className="scrollbar-hide mt-4 flex gap-4 overflow-x-auto px-4 py-2">
            <StatCard label="Active Pupils" value={passports.length} isAlert={false} />
            <StatCard
              label="Red Alerts Today"
              value={isLoadingCheckins ? "…" : redAlertCount}
              isAlert={!isLoadingCheckins && redAlertCount > 0}
            />
            <StatCard label="Unopened Messages" value="0" isSubdued />
          </div>

          <section className="mt-4 grid grid-cols-2 gap-3 px-4">
            {isLoadingCheckins
              ? Array.from({ length: 6 }).map((_, i) => <MorningPupilCardSkeleton key={i} />)
              : gridPupils.map((pupil) => (
                  <MorningPupilCard
                    key={pupil.passportId}
                    pupil={pupil}
                    onTap={() => setSelectedPupil(pupil)}
                  />
                ))}
          </section>

          {!isLoadingCheckins && overflowCount > 0 && (
            <Link
              href="/teacher/morning-updates"
              className="mt-3 block w-full px-4 text-center font-sans text-sm font-bold text-brand-prussian-blue"
            >
              [ View all {pupils.length} morning updates ]
            </Link>
          )}

          <TeacherQuickActions />
          <TeacherActivityCard />
        </>
      )}

      {institutionId && (
        <AddChildSheet
          isOpen={isAddChildOpen}
          onClose={() => setIsAddChildOpen(false)}
          teacherId={user!.id}
          teacherName={(user!.user_metadata?.full_name as string | undefined) ?? "A teacher"}
          institutionId={institutionId}
          institutionCode={institutionCode}
          onAdded={refresh}
        />
      )}

      <MorningCheckinDetailSheet pupil={selectedPupil} onClose={() => setSelectedPupil(null)} />

      <TeacherBottomNav active="dashboard" />
    </div>
  );
}

function StatCard({
  label,
  value,
  isAlert,
  isSubdued,
}: {
  label: string;
  value: string | number;
  isAlert?: boolean;
  isSubdued?: boolean;
}) {
  return (
    <div className="min-w-[130px] flex-shrink-0 rounded-xl border border-brand-off-white bg-white p-4 shadow-sm">
      <p className="font-accent text-xs uppercase text-brand-neutral-black/60">{label}</p>
      <p
        className={`mt-1 font-heading text-2xl font-bold ${
          isSubdued
            ? "text-brand-neutral-black/30"
            : isAlert
              ? "text-red-600"
              : "text-brand-neutral-black"
        }`}
      >
        {value}
      </p>
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
    <div className="flex flex-1 flex-col items-center px-4 pt-6 text-center">
      <p className="mb-6 font-sans text-sm leading-relaxed text-brand-neutral-black/60">
        This is where you will see your students&apos; daily check-ins. Your
        dashboard is currently empty.
      </p>

      <div className="w-full rounded-3xl border border-brand-off-white bg-white p-6 shadow-sm">
        <p className="mb-2 font-accent text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
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
        <p className="font-sans text-sm leading-relaxed text-brand-neutral-black/60">
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
