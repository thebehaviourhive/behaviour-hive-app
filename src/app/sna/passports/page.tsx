"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTeacherPassports } from "@/hooks/useTeacherPassports";
import { useTeacherMorningCheckins, type MorningPupilStatus } from "@/hooks/useTeacherMorningCheckins";
import { getChildDisplayName } from "@/lib/childDisplayName";
import { AddChildSheet } from "@/components/teacher/AddChildSheet";
import { SnaBottomNav } from "@/components/sna/SnaBottomNav";
import { AlertTriangleIcon, PeopleIcon } from "@/components/ui/icons";
import { QuestionnairePromptCard } from "@/components/questionnaire/QuestionnairePromptCard";
import { AttestationPromptCard } from "@/components/incident-log/AttestationPromptCard";

// SNA's "Passports home" -- per the brief, this single page IS the SNA
// track's roster (there's no separate Students page the way the
// teacher track has one, since SNA's nav is just Passports/More). It
// combines the teacher dashboard's morning-status chip with the
// Students page's tap-through list, because SNA has nowhere else for
// either of those to live.
//
// useTeacherPassports/useTeacherMorningCheckins are reused verbatim,
// not forked: both already query passport_access scoped to
// `teacher_id = auth.uid()` with no role filter, so an SNA calling them
// gets exactly their own linked children -- the same "role-blind and
// therefore already correct" reasoning documented throughout migration
// 0065 (get_abc_logs, the passports/section SELECT policies, etc.)
// applies identically to these two client-side hooks.
const RAG_LABEL: Record<MorningPupilStatus["rag"], string> = {
  green: "Settled",
  amber: "Anxious",
  red: "Dysregulated",
  grey: "Awaiting check-in",
};

const RAG_CLASS: Record<MorningPupilStatus["rag"], string> = {
  green: "bg-green-50 text-green-800",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-800",
  grey: "bg-black/5 text-black/50",
};

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

export default function SnaPassportsPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("sna");
  const {
    isLoading: isLoadingPassports,
    error,
    institutionId,
    institutionCode,
    passports,
    refresh,
  } = useTeacherPassports(user?.id ?? null);
  const { isLoading: isLoadingCheckins, pupils } = useTeacherMorningCheckins(user?.id ?? null);

  const [query, setQuery] = useState("");
  const [isAddChildOpen, setIsAddChildOpen] = useState(false);

  const isLoading = isLoadingPassports || isLoadingCheckins;

  const diagnosesByPassportId = useMemo(() => {
    const map = new Map<string, { diagnoses: string[] | null; diagnosisOther: string | null; childName: string }>();
    for (const p of passports) {
      map.set(p.passportId, { diagnoses: p.diagnoses, diagnosisOther: p.diagnosisOther, childName: p.childName });
    }
    return map;
  }, [passports]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pupils;
    return pupils.filter((p) => p.firstName.toLowerCase().includes(q));
  }, [pupils, query]);

  // Same pattern as teacher/dashboard -- was missing here entirely, found
  // while extending useTeacherPassports' resolution query to exclude
  // pending/rejected (Stage 1b Step 3). Without this, this page silently
  // rendered with its institution-gated sections just missing instead of
  // sending someone with no active row to join-institution's own status
  // page -- the same "broken dashboard instead of a clear state" gap
  // Daniel's brief named explicitly.
  useEffect(() => {
    if (!isReady || isLoadingPassports) return;
    if (institutionId === null) router.replace("/teacher/join-institution");
  }, [isReady, isLoadingPassports, institutionId, router]);

  if (!isReady || isLoadingPassports || institutionId === null) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center justify-between gap-3 p-4">
        <h1 className="font-heading text-2xl text-brand-prussian-blue">Passports</h1>
        <div className="flex items-center gap-2">
          {institutionId && (
            <Link
              href="/teacher/incidents/new"
              aria-label="Record incident"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-golden-brown text-white shadow-sm"
            >
              <AlertTriangleIcon className="h-5 w-5" />
            </Link>
          )}
          {institutionId && (
            <button
              type="button"
              onClick={() => setIsAddChildOpen(true)}
              aria-label="Add a child"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-prussian-blue text-lg text-white shadow-sm"
            >
              +
            </button>
          )}
        </div>
      </header>

      <QuestionnairePromptCard track="sna" className="px-4 pb-4" />
      <AttestationPromptCard className="px-4 pb-4" />

      {passports.length > 0 && (
        <div className="sticky top-0 z-[1] bg-brand-off-white/40 px-4 pb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by first name"
            className="w-full rounded-xl border border-brand-off-white bg-white px-4 py-2 font-sans text-sm text-brand-neutral-black placeholder:text-brand-neutral-black/40 focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
        </div>
      )}

      <main className="flex-1">
        {isLoading ? (
          <div className="flex flex-col">
            {Array.from({ length: 6 }).map((_, i) => (
              <ChildRowSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="mx-4 rounded-xl border-2 border-dashed border-red-200 bg-white/60 p-6 text-center">
            <p className="font-sans text-sm text-red-600">{error}</p>
          </div>
        ) : passports.length === 0 ? (
          <EmptyState institutionCode={institutionCode} onAddChild={() => setIsAddChildOpen(true)} />
        ) : filtered.length === 0 ? (
          <p className="px-4 pt-6 text-center font-sans text-sm text-brand-neutral-black/60">
            No children match &quot;{query}&quot;.
          </p>
        ) : (
          <div className="flex flex-col">
            {filtered.map((pupil) => {
              const info = diagnosesByPassportId.get(pupil.passportId);
              return (
                <ChildRow
                  key={pupil.passportId}
                  pupil={pupil}
                  childName={info?.childName ?? pupil.displayName}
                  pills={getDiagnosisPills(info?.diagnoses ?? null, info?.diagnosisOther ?? null)}
                  onTap={() => router.push(`/sna/passport/${pupil.passportId}`)}
                />
              );
            })}
          </div>
        )}
      </main>

      {institutionId && user && (
        <AddChildSheet
          isOpen={isAddChildOpen}
          onClose={() => setIsAddChildOpen(false)}
          teacherId={user.id}
          teacherName={(user.user_metadata?.full_name as string | undefined) ?? "An SNA"}
          institutionId={institutionId}
          institutionCode={institutionCode}
          onAdded={refresh}
          actorRole="sna"
        />
      )}

      <SnaBottomNav />
    </div>
  );
}

function ChildRow({
  pupil,
  childName,
  pills,
  onTap,
}: {
  pupil: MorningPupilStatus;
  childName: string;
  pills: string[];
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center gap-4 border-b border-brand-off-white bg-white py-3 px-4 text-left last:border-b-0"
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-pastel-blue/30 font-heading font-bold text-brand-prussian-blue">
        {getInitials(pupil.firstName, childName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-base font-bold text-brand-neutral-black">
          {getChildDisplayName(childName)}
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
      <span
        className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${RAG_CLASS[pupil.rag]}`}
      >
        {RAG_LABEL[pupil.rag]}
      </span>
    </button>
  );
}

function ChildRowSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-4 border-b border-brand-off-white bg-white py-3 px-4 last:border-b-0">
      <span className="h-10 w-10 flex-shrink-0 rounded-full bg-black/10" />
      <div className="flex-1">
        <span className="block h-4 w-24 rounded bg-black/10" />
      </div>
      <span className="h-5 w-16 flex-shrink-0 rounded-full bg-black/10" />
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
    <div className="flex flex-col items-center gap-3 px-4 pt-6 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-pastel-blue/30 text-brand-prussian-blue">
        <PeopleIcon className="h-10 w-10" />
      </span>
      <p className="font-sans text-base font-bold text-brand-neutral-black">
        No children linked yet.
      </p>
      <p className="max-w-[280px] font-sans text-sm text-brand-neutral-black/60">
        Ask a parent for their child&apos;s passport code, or share your
        school&apos;s institution code so they can approve you first.
      </p>

      <div className="mt-3 w-full rounded-3xl border border-brand-off-white bg-white p-6 shadow-sm">
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

        <button
          type="button"
          onClick={onAddChild}
          className="w-full rounded-2xl bg-brand-golden-brown py-3.5 text-base font-semibold text-white shadow-sm"
        >
          + Add Child
        </button>
      </div>
    </div>
  );
}
