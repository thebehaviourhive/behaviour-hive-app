"use client";

import Link from "next/link";
import { useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTeacherMorningCheckins, type MorningPupilStatus } from "@/hooks/useTeacherMorningCheckins";
import { MorningPupilCard, MorningPupilCardSkeleton } from "@/components/teacher/MorningPupilCard";
import { MorningCheckinDetailSheet } from "@/components/teacher/MorningCheckinDetailSheet";

export default function TeacherMorningUpdatesPage() {
  const { user, isReady } = useRequireRole("class_teacher");
  const { isLoading, pupils } = useTeacherMorningCheckins(user?.id ?? null);
  const [selectedPupil, setSelectedPupil] = useState<MorningPupilStatus | null>(null);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/teacher/dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">
          Morning Updates
        </h1>
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <MorningPupilCardSkeleton key={i} />
            ))}
          </div>
        ) : pupils.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="font-sans text-sm text-brand-neutral-black/70">
              No students linked yet.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {pupils.map((pupil) => (
              <MorningPupilCard
                key={pupil.passportId}
                pupil={pupil}
                onTap={() => setSelectedPupil(pupil)}
              />
            ))}
          </div>
        )}
      </main>

      <MorningCheckinDetailSheet pupil={selectedPupil} onClose={() => setSelectedPupil(null)} />
    </div>
  );
}
