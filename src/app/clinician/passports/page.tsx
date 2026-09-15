"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { ClinicianBottomNav } from "@/components/clinician/ClinicianBottomNav";
import { ClinicalFileDetail } from "@/components/clinician/ClinicalFileDetail";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

interface ClinicianPassportRow {
  clinician_access_id: string;
  passport_id: string;
  // Full name, shown as-is to clinicians (unlike the redacted teacher-track
  // view) -- clinical records require certainty of identity. Deliberate
  // product decision, pending clinical sign-off.
  child_name: string;
  date_of_birth: string | null;
  diagnoses: string[] | null;
  diagnosis_other: string | null;
  last_review_date: string;
  // Stage 7: which authority connected this case -- a parent, or a
  // school on the family's behalf. Shown per card so a clinician can
  // tell at a glance who engaged them, symmetric with the parent/
  // principal's own view of the same relationship.
  engaged_by: "parent" | "institution";
  engaged_by_institution_name: string | null;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  // Clinician desktop pass, Stage 2 -- split view, same
  // ClassesList/ChildrenList pattern PRD 4's Directory established:
  // below lg the Link below navigates for real (unchanged); at lg+ the
  // click is intercepted (preventDefault) and fills this instead, so
  // the right pane renders without leaving this page.
  const [selectedPassportId, setSelectedPassportId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_clinician_passports");

    if (error) {
      console.error("Failed to load clinician passports:", error);
      setLoadError("Couldn't load your passports.");
      setIsLoading(false);
      return;
    }

    setPassports((data ?? []) as ClinicianPassportRow[]);
    setIsLoading(false);
  }, []);

  // Fetches once the role check is ready and whenever `load`'s identity
  // changes -- a genuine effect for syncing with the external data
  // source, not a synchronous state derivation.
  useEffect(() => {
    if (!isReady) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [isReady, load]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-8 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
          Passports
        </h1>
      </header>

      {/* Same 4/8-of-12 grid as principal/directory/page.tsx. Below lg
          lg:grid never applies, so this is a plain block containing a
          plain block -- today's single-column list, unchanged. */}
      <main className="flex-1 px-4 pt-3">
        <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
          <div className="lg:col-span-4">
            <div className="flex flex-col gap-3">
              {isLoading ? (
                <>
                  <PassportCardSkeleton />
                  <PassportCardSkeleton />
                </>
              ) : loadError ? (
                <InlineErrorState message={loadError} onRetry={load} />
              ) : passports.length === 0 ? (
                <div className="mt-4 rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
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
                      onClick={(e) => {
                        if (window.matchMedia("(min-width: 1024px)").matches) {
                          e.preventDefault();
                          setSelectedPassportId(passport.passport_id);
                        }
                      }}
                      className={`rounded-2xl border p-4 shadow-sm ${
                        passport.passport_id === selectedPassportId
                          ? "border-brand-prussian-blue bg-brand-pastel-blue/10"
                          : "border-black/5 bg-white"
                      }`}
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
                              className="rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 font-accent text-xs font-semibold text-brand-prussian-blue"
                            >
                              {pill}
                            </span>
                          ))}
                        </div>
                      )}

                      <p className="mt-2 text-xs text-brand-neutral-black/50">
                        Last reviewed: {format(new Date(passport.last_review_date), "d MMM yyyy")}
                      </p>
                      <p className="mt-1 text-xs text-brand-neutral-black/40">
                        {passport.engaged_by === "parent"
                          ? "Connected by the family"
                          : `Connected by ${passport.engaged_by_institution_name ?? "the school"}`}
                      </p>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          <div className="mt-6 hidden lg:col-span-8 lg:mt-0 lg:block">
            {!selectedPassportId ? (
              <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
                <p className="font-sans text-body text-brand-neutral-black/60">
                  Select a case from the list to see its clinical file.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
                <ClinicalFileDetail passportId={selectedPassportId} />
              </div>
            )}
          </div>
        </div>
      </main>

      <ClinicianBottomNav />
    </div>
  );
}

function PassportCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="h-5 w-32 rounded bg-brand-off-white" />
      <div className="mt-3 flex gap-1.5">
        <div className="h-5 w-16 rounded-full bg-brand-off-white" />
        <div className="h-5 w-20 rounded-full bg-brand-off-white" />
      </div>
      <div className="mt-3 h-3 w-24 rounded bg-brand-off-white" />
    </div>
  );
}
