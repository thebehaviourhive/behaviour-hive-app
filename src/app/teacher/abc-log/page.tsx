"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTeacherPassports, type TeacherPassport } from "@/hooks/useTeacherPassports";
import { getChildDisplayName } from "@/lib/childDisplayName";
import { ABCLogger } from "@/components/abc-logger/ABCLogger";

export default function TeacherAbcLogPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("class_teacher");
  const { isLoading, passports } = useTeacherPassports(user?.id ?? null);

  const [selectedPassport, setSelectedPassport] = useState<TeacherPassport | null>(null);
  const [isAbcLoggerOpen, setIsAbcLoggerOpen] = useState(false);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <button
          type="button"
          onClick={() =>
            selectedPassport ? setSelectedPassport(null) : router.push("/teacher/dashboard")
          }
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Add Log</h1>
      </header>

      <main className="flex-1 px-4 pb-10">
        {!selectedPassport ? (
          <>
            <p className="mb-4 font-accent text-sm font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Select a student to log against
            </p>

            {isLoading ? (
              <div className="flex flex-col gap-2">
                <div className="h-16 animate-pulse rounded-2xl bg-white" />
                <div className="h-16 animate-pulse rounded-2xl bg-white" />
              </div>
            ) : passports.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
                <p className="font-sans text-sm text-brand-neutral-black/70">
                  Link a student to your classroom to start logging incidents.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {passports.map((passport) => (
                  <button
                    key={passport.passportId}
                    type="button"
                    onClick={() => setSelectedPassport(passport)}
                    className="w-full rounded-2xl border border-brand-off-white bg-white p-4 text-left text-base font-semibold text-brand-neutral-black shadow-sm transition-colors active:bg-black/[0.02]"
                  >
                    {getChildDisplayName(passport.childName)}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mb-1 font-sans text-sm text-brand-neutral-black/60">Logging for</p>
            <p className="mb-4 font-heading text-xl font-bold text-brand-prussian-blue">
              {getChildDisplayName(selectedPassport.childName)}
            </p>

            <button
              type="button"
              onClick={() => setIsAbcLoggerOpen(true)}
              className="w-full rounded-2xl border border-brand-off-white bg-white p-4 text-left text-base font-semibold text-brand-neutral-black shadow-sm"
            >
              ABC Log
            </button>
          </>
        )}
      </main>

      {isAbcLoggerOpen && selectedPassport && (
        <ABCLogger
          passportId={selectedPassport.passportId}
          childName={selectedPassport.firstName}
          role="class_teacher"
          onComplete={() => {
            setIsAbcLoggerOpen(false);
            router.push("/teacher/dashboard");
          }}
          onDismiss={() => setIsAbcLoggerOpen(false)}
        />
      )}
    </div>
  );
}
