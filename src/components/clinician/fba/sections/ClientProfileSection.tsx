"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { TextField } from "@/components/ui/TextField";
import type { FbaSectionBodyProps } from "./types";

interface PassportProfile {
  childName: string;
  dateOfBirth: string | null;
  diagnoses: string[] | null;
  diagnosisOther: string | null;
}

function getDiagnosisPills(diagnoses: string[] | null, diagnosisOther: string | null): string[] {
  if (!diagnoses || diagnoses.length === 0) return [];
  if (diagnoses.includes("Other") && diagnosisOther) {
    return [...diagnoses.filter((d) => d !== "Other"), diagnosisOther];
  }
  return diagnoses;
}

// Section 1: auto-populated read-only child data + report date, plus one
// editable field (Residence). The child/DOB/diagnoses fetch is scoped to
// this section alone rather than lifted to the workspace page -- this
// app doesn't cache client-side (see useFbaReport's header comment), so
// each page/section fetches exactly what it needs.
export function ClientProfileSection({
  passportId,
  content,
  onFieldChange,
  onFieldBlur,
  readOnly,
}: FbaSectionBodyProps & { passportId: string }) {
  const [profile, setProfile] = useState<PassportProfile | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("passports")
      .select("child_name, date_of_birth, diagnoses, diagnosis_other")
      .eq("id", passportId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error || !data) {
          setLoadError(true);
          return;
        }
        setProfile({
          childName: data.child_name,
          dateOfBirth: data.date_of_birth,
          diagnoses: data.diagnoses,
          diagnosisOther: data.diagnosis_other,
        });
      });
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  const diagnosisPills = getDiagnosisPills(profile?.diagnoses ?? null, profile?.diagnosisOther ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
          Child
        </p>
        {loadError ? (
          <p className="mt-1 text-sm text-red-600">Couldn&apos;t load passport details.</p>
        ) : !profile ? (
          <div className="mt-2 h-5 w-32 animate-pulse rounded bg-brand-off-white" />
        ) : (
          <>
            <p className="mt-1 font-heading text-lg font-bold text-brand-neutral-black">
              {profile.childName}
            </p>
            {profile.dateOfBirth && (
              <p className="mt-0.5 text-sm text-brand-neutral-black/60">
                DOB: {format(new Date(profile.dateOfBirth), "d MMM yyyy")}
              </p>
            )}
            {diagnosisPills.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {diagnosisPills.map((pill) => (
                  <span
                    key={pill}
                    className="rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 font-accent text-xs font-semibold text-brand-prussian-blue"
                  >
                    {pill}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
          Report Date
        </p>
        <p className="mt-1 text-base text-brand-neutral-black">
          {content.reportDate ? format(new Date(content.reportDate), "d MMM yyyy") : "—"}
        </p>
      </div>

      {readOnly ? (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-brand-neutral-black">Residence</p>
          <p className="rounded-2xl border border-black/5 bg-white p-4 text-base text-brand-neutral-black">
            {content.residence?.trim() ? (
              content.residence
            ) : (
              <span className="text-black/30">Not recorded.</span>
            )}
          </p>
        </div>
      ) : (
        <TextField
          label="Residence"
          value={content.residence ?? ""}
          onChange={(e) => onFieldChange({ ...content, residence: e.target.value })}
          onBlur={onFieldBlur}
          placeholder="e.g. Lives at home with both parents"
        />
      )}
    </div>
  );
}
