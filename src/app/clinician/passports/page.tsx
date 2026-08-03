"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { ClinicianBottomNav } from "@/components/clinician/ClinicianBottomNav";

interface ClinicianPassportRow {
  passport_id: string;
  child_name: string;
  date_of_birth: string | null;
  diagnoses: string[] | null;
  diagnosis_other: string | null;
  last_review_date: string;
}

function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function getDiagnosisPills(diagnoses: string[] | null, diagnosisOther: string | null): string[] {
  if (!diagnoses || diagnoses.length === 0) return [];
  if (diagnoses.includes("Other") && diagnosisOther) {
    return [...diagnoses.filter((d) => d !== "Other"), diagnosisOther];
  }
  return diagnoses;
}

export default function ClinicianPassportsPage() {
  const { isReady } = useRequireRole("clinician");
  const [passports, setPassports] = useState<ClinicianPassportRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isReady) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_clinician_passports");

      if (!isMounted) return;
      setPassports((data ?? []) as ClinicianPassportRow[]);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [isReady]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-safe-ivory pb-24">
      <header className="px-4 pt-8 pb-2">
        <h1 className="font-heading text-2xl font-bold text-brand-prussian-blue">
          Passports
        </h1>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pt-3">
        {isLoading ? (
          <>
            <PassportCardSkeleton />
            <PassportCardSkeleton />
          </>
        ) : passports.length === 0 ? (
          <div className="mt-4 rounded-2xl border-2 border-dashed border-brand-golden-brown/40 bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">
              When parents connect their child&apos;s passport using your
              clinician code, cases will appear here.
            </p>
          </div>
        ) : (
          passports.map((passport) => {
            const age = calculateAge(passport.date_of_birth);
            const pills = getDiagnosisPills(passport.diagnoses, passport.diagnosis_other);

            return (
              <Link
                key={passport.passport_id}
                href={`/clinician/passport/${passport.passport_id}`}
                className="rounded-2xl border-t-4 border-brand-golden-brown bg-white p-4 shadow-sm"
              >
                <h2 className="font-heading text-xl font-bold text-brand-neutral-black">
                  {passport.child_name}
                  {age !== null && (
                    <span className="ml-1.5 font-sans text-sm font-normal text-brand-neutral-black/50">
                      {age} yrs
                    </span>
                  )}
                </h2>

                {pills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {pills.map((pill) => (
                      <span
                        key={pill}
                        className="rounded-full bg-brand-golden-brown/10 px-2.5 py-1 font-accent text-xs font-semibold text-brand-golden-brown"
                      >
                        {pill}
                      </span>
                    ))}
                  </div>
                )}

                <p className="mt-2 text-xs text-brand-neutral-black/50">
                  Last reviewed: {format(new Date(passport.last_review_date), "d MMM yyyy")}
                </p>
              </Link>
            );
          })
        )}
      </main>

      <ClinicianBottomNav active="passports" />
    </div>
  );
}

function PassportCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border-t-4 border-brand-off-white bg-white p-4 shadow-sm">
      <div className="h-5 w-32 rounded bg-brand-off-white" />
      <div className="mt-3 flex gap-1.5">
        <div className="h-5 w-16 rounded-full bg-brand-off-white" />
        <div className="h-5 w-20 rounded-full bg-brand-off-white" />
      </div>
      <div className="mt-3 h-3 w-24 rounded bg-brand-off-white" />
    </div>
  );
}
