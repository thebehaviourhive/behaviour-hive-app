"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { TextField } from "@/components/ui/TextField";
import { useRegions } from "@/hooks/useRegions";
import type { FbaSectionBodyProps } from "./types";

interface PassportProfile {
  childName: string;
  dateOfBirth: string | null;
  diagnoses: string[] | null;
  diagnosisOther: string | null;
  countyId: string | null;
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
  onStructuralChange,
  readOnly,
}: FbaSectionBodyProps & { passportId: string }) {
  const [profile, setProfile] = useState<PassportProfile | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Two plain queries (passports, then a lookup against regions),
  // rather than a PostgREST embedded-resource select -- no existing
  // precedent for that pattern anywhere else in this codebase's client
  // code (see useCalmEscalationNotices.ts's own reasoning for the same
  // choice). regions is a small, already-fetched-elsewhere reference
  // list, cheap to pull in full here too.
  const { regions } = useRegions();

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("passports")
      .select("child_name, date_of_birth, diagnoses, diagnosis_other, county_id")
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
          countyId: data.county_id,
        });
      });
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  // Resolved reactively (not inside the fetch above) so it's correct
  // regardless of which of the two independent fetches -- this
  // component's own passport fetch, and useRegions()'s -- happens to
  // resolve first. Resolving it once inside the passport .then() would
  // race: if regions was still [] at that moment, the lookup would
  // silently miss and never retry, since that effect only re-runs on
  // passportId changing. (Caught live: prefill never fired because
  // regions loaded after the passport fetch resolved.)
  const countyName = profile?.countyId ? regions.find((r) => r.id === profile.countyId)?.name ?? null : null;

  // Prefill Residence from the child's passport county -- ONLY a
  // default, never a synced value: fires once county name resolves,
  // and only when Residence is still genuinely empty (never overwrites
  // an authored value, even if the county is set/changed afterwards --
  // once residence is non-empty this guard alone stops it from ever
  // firing again, so it's safe to depend on countyName/regions here).
  // Never in the readOnly branch -- a locked FBA's content_data can't
  // be edited through the normal save path at all (see this section's
  // own readOnly branch below), so there's nothing to prefill into.
  //
  // Uses onStructuralChange, NOT onFieldChange+onFieldBlur -- the two
  // update the SAME parent `content` state but through separate calls,
  // and onFieldBlur reads the parent's `content` via a closure that
  // hasn't yet observed the onFieldChange that ran moments earlier in
  // this same effect (setState is async), so it saves the OLD content,
  // silently dropping the prefill. Caught live: the write appeared to
  // "Save" in the UI but the persisted content_data.residence stayed
  // empty. onStructuralChange takes the next value as an explicit
  // argument instead of reading state, exactly for updates with "no
  // natural blur moment" (its own doc comment on FbaSectionBodyProps) --
  // a programmatic prefill is precisely that.
  useEffect(() => {
    if (readOnly || !profile) return;
    if (content.residence?.trim()) return;
    if (!countyName) return;
    onStructuralChange({ ...content, residence: countyName });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately NOT keyed on content/onStructuralChange: re-running on every content-identity change would turn this into a synced value, not a one-time default, which the comment above says this must never become. The content.residence emptiness check plus setting a non-empty value is what makes this idempotent despite the narrow dep list.
  }, [profile, countyName, readOnly]);

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
