"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ABCLogger } from "@/components/abc-logger/ABCLogger";
import { ClinicalFileIcon } from "@/components/ui/icons";

interface ClinicianPassportOption {
  passport_id: string;
  child_name: string;
}

type LogType = "abc" | "fba" | "bsp";

export default function ClinicianAddLogPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("clinician");

  const [passports, setPassports] = useState<ClinicianPassportOption[]>([]);
  const [isLoadingPassports, setIsLoadingPassports] = useState(true);
  const [selectedPassport, setSelectedPassport] = useState<ClinicianPassportOption | null>(null);
  const [showAdvancedComingSoon, setShowAdvancedComingSoon] = useState(false);
  const [isAbcLoggerOpen, setIsAbcLoggerOpen] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_clinician_passports");

      if (!isMounted) return;
      setPassports((data ?? []) as ClinicianPassportOption[]);
      setIsLoadingPassports(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [isReady]);

  function selectLogType(logType: LogType) {
    if (logType === "abc") {
      setIsAbcLoggerOpen(true);
      return;
    }
    setShowAdvancedComingSoon(true);
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <button
          type="button"
          onClick={() =>
            selectedPassport ? setSelectedPassport(null) : router.push("/clinician/dashboard")
          }
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">
          Add Log
        </h1>
      </header>

      <main className="flex-1 px-4 pb-10">
        {!selectedPassport ? (
          <>
            <p className="mb-4 font-accent text-sm font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Select a case to log against
            </p>

            {isLoadingPassports ? (
              <div className="flex flex-col gap-2">
                <div className="h-16 animate-pulse rounded-2xl bg-white" />
                <div className="h-16 animate-pulse rounded-2xl bg-white" />
              </div>
            ) : passports.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
                <p className="text-sm text-brand-neutral-black/70">
                  When parents connect their child&apos;s passport using your
                  clinician code, cases will appear here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {passports.map((passport) => (
                  <button
                    key={passport.passport_id}
                    type="button"
                    onClick={() => setSelectedPassport(passport)}
                    className="w-full rounded-2xl border border-black/5 bg-white p-4 text-left text-base font-semibold text-brand-neutral-black shadow-sm transition-colors active:bg-black/[0.02]"
                  >
                    {passport.child_name}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mb-1 text-sm text-brand-neutral-black/60">
              Logging for
            </p>
            <p className="mb-4 font-heading text-xl font-bold text-brand-prussian-blue">
              {selectedPassport.child_name}
            </p>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => selectLogType("abc")}
                className="w-full rounded-2xl border border-black/5 bg-white p-4 text-left text-base font-semibold text-brand-neutral-black shadow-sm"
              >
                ABC Log
              </button>
              <button
                type="button"
                onClick={() => selectLogType("fba")}
                className="w-full rounded-2xl border border-black/5 bg-white p-4 text-left text-base font-semibold text-brand-neutral-black shadow-sm"
              >
                FBA Log
              </button>
              <button
                type="button"
                onClick={() => selectLogType("bsp")}
                className="w-full rounded-2xl border border-black/5 bg-white p-4 text-left text-base font-semibold text-brand-neutral-black shadow-sm"
              >
                BSP Log
              </button>
            </div>
          </>
        )}
      </main>

      <BottomSheet isOpen={showAdvancedComingSoon} onClose={() => setShowAdvancedComingSoon(false)}>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
            <ClinicalFileIcon className="h-8 w-8" />
          </span>
          <p className="text-sm text-brand-neutral-black/70">
            Advanced clinical logging modules are currently in development.
          </p>
          <button
            type="button"
            onClick={() => setShowAdvancedComingSoon(false)}
            className="mt-2 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white"
          >
            Return
          </button>
        </div>
      </BottomSheet>

      {isAbcLoggerOpen && selectedPassport && user && (
        <ABCLogger
          passportId={selectedPassport.passport_id}
          childName={selectedPassport.child_name}
          role="clinician"
          onComplete={() => {
            setIsAbcLoggerOpen(false);
            router.push("/clinician/dashboard");
          }}
          onDismiss={() => setIsAbcLoggerOpen(false)}
        />
      )}
    </div>
  );
}
