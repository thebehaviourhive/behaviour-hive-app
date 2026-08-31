"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { PassportProgress } from "@/components/ui/PassportProgress";
import { DiagnosisSelect } from "@/components/passport/DiagnosisSelect";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useRegions } from "@/hooks/useRegions";
import { useMyPassport } from "@/hooks/useMyPassport";
import { getPassportProgressPercent } from "@/lib/passportProgress";
import { IMPORTANT_PEOPLE_TITLE } from "@/lib/passportCopy";
import { DIAGNOSIS_OTHER } from "@/lib/diagnosisOptions";

// PRD 3, Stage 1 -- two real bugs fixed together, same client change:
//
// (1) THE URGENT ONE: .upsert(payload, { onConflict: "user_id" }) sends
// Prefer: return=representation by default, even with no .select()
// chained -- so the new row had to pass passports' own SELECT policy
// (owns_passport(id), migration 0117) WITHIN THE SAME STATEMENT. That
// policy depends on a passport_guardians row a trigger creates AFTER
// the insert -- invisible to the same-statement check. Every brand-new
// parent's first-ever save hit this, in production, since 0117 shipped
// -- not a claimed-guardian edge case, everyone's first save. See
// CLAUDE.md's new gotcha entry.
//
// (2) THE ONE THIS STAGE SET OUT TO FIX: a claimed guardian's passport
// has no user_id at all, so onConflict: "user_id" could never find it
// to update -- it would silently create a second, orphaned passport
// instead (RLS permits it; a fresh row with the guardian's own user_id
// is a perfectly legal insert on its own terms).
//
// Same fix closes both: resolve the existing passport (if any) via
// useMyPassport() -- guardian-aware, works for both origins -- THEN
// branch explicitly. An existing passport gets a plain .update().eq(
// "id", ...), payload never including user_id (that column carries
// migration 0113's own dual-write-trigger meaning, not "who edited
// this"; a claimed guardian must never set it, and leaving it out of
// an update on a self-created passport leaves it correctly unchanged
// either way). No existing passport means a genuine first-time
// .insert(), user_id included, exactly as before -- and, per gotcha
// #new, that bare insert is never followed by a chained .select().

export default function PassportSectionAPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("parent");
  const { passportId: existingPassportId, isLoading: isLoadingPassportId } = useMyPassport(user?.id);

  const [childName, setChildName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [school, setSchool] = useState("");
  const [importantPeople, setImportantPeople] = useState("");
  const [diagnoses, setDiagnoses] = useState<string[]>([]);
  const [diagnosisOther, setDiagnosisOther] = useState("");
  const [countyId, setCountyId] = useState<string>("");
  const { regions } = useRegions();

  const [isLoadingExisting, setIsLoadingExisting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Tracks the passport's CURRENT status so saving this section never
  // downgrades an already-complete passport back to "in_progress" — see
  // buildPayload().
  const [currentPassportStatus, setCurrentPassportStatus] = useState<
    "not_started" | "in_progress" | "complete"
  >("not_started");

  useEffect(() => {
    if (!user || isLoadingPassportId) return;

    if (!existingPassportId) {
      // Genuinely nothing to load -- a brand-new parent, first visit.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoadingExisting(false);
      return;
    }

    let isMounted = true;

    async function loadExisting() {
      const supabase = createClient();
      const { data } = await supabase
        .from("passports")
        .select(
          "child_name, date_of_birth, school, important_people, diagnoses, diagnosis_other, county_id, passport_status"
        )
        .eq("id", existingPassportId)
        .maybeSingle();

      if (!isMounted || !data) {
        if (isMounted) setIsLoadingExisting(false);
        return;
      }

      setChildName(data.child_name ?? "");
      setDateOfBirth(data.date_of_birth ?? "");
      setSchool(data.school ?? "");
      setImportantPeople(data.important_people ?? "");
      setDiagnoses(data.diagnoses ?? []);
      setDiagnosisOther(data.diagnosis_other ?? "");
      setCountyId(data.county_id ?? "");
      setCurrentPassportStatus(
        (data.passport_status as "not_started" | "in_progress" | "complete" | null) ??
          "not_started"
      );
      setIsLoadingExisting(false);
    }

    loadExisting();
    return () => {
      isMounted = false;
    };
  }, [user, existingPassportId, isLoadingPassportId]);

  function toggleDiagnosis(value: string) {
    setDiagnoses((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  // Deliberately never includes user_id -- see the header note. The
  // insert branch below adds it back in only for a genuinely new
  // passport.
  function buildPayload() {
    return {
      child_name: childName || null,
      date_of_birth: dateOfBirth || null,
      school: school || null,
      important_people: importantPeople || null,
      diagnoses: diagnoses.length > 0 ? diagnoses : null,
      diagnosis_other: diagnoses.includes(DIAGNOSIS_OTHER) ? diagnosisOther || null : null,
      county_id: countyId || null,
      // Never downgrade an already-complete passport just because one
      // section was edited afterwards — only "upgrade" not_started/
      // in_progress to in_progress.
      passport_status:
        currentPassportStatus === "complete"
          ? ("complete" as const)
          : ("in_progress" as const),
    };
  }

  // Explicit insert-vs-update, never upsert -- see the header note for
  // both reasons why. Neither branch chains .select(): the insert
  // branch would hit the same same-statement SELECT-policy timing gap
  // upsert did (owns_passport(id) can't see the trigger's own
  // passport_guardians row yet); the update branch doesn't need
  // representation back at all. Confirming the write succeeded, on the
  // rare occasion a caller needs to, means a separate follow-up query,
  // not a chained one.
  async function savePassport(
    payload: ReturnType<typeof buildPayload> & { section_a_complete?: boolean }
  ): Promise<string | null> {
    const supabase = createClient();
    if (existingPassportId) {
      const { error } = await supabase.from("passports").update(payload).eq("id", existingPassportId);
      return error?.message ?? null;
    }
    const { error } = await supabase.from("passports").insert({ ...payload, user_id: user!.id });
    return error?.message ?? null;
  }

  async function handleSaveAndContinue(event: FormEvent) {
    event.preventDefault();
    if (!user) return;

    setError(null);
    setIsSaving(true);

    const saveError = await savePassport({ ...buildPayload(), section_a_complete: true });

    setIsSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    router.push("/passport/section-b/1");
  }

  async function handleSaveAndExit() {
    if (!user) return;

    setError(null);
    setIsSaving(true);

    const saveError = await savePassport(buildPayload());

    setIsSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    router.push("/parent-dashboard");
  }

  if (!isReady || isLoadingExisting) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            About Your Child
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <PassportProgress
            sectionLabel="Section 1 of 4"
            percent={getPassportProgressPercent(1)}
          />

          <form onSubmit={handleSaveAndContinue} className="flex flex-col gap-4">
            <TextField
              label="Child's name"
              type="text"
              placeholder="Aoife Murphy"
              required
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />

            <TextField
              label="Date of birth"
              type="date"
              required
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />

            <TextField
              label="School"
              type="text"
              placeholder="St. Brendan's NS"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
            />

            <div className="flex flex-col gap-1.5">
              <TextField
                label={IMPORTANT_PEOPLE_TITLE}
                type="text"
                placeholder="Mum, Dad, Gran, Ms. O'Brien"
                value={importantPeople}
                onChange={(e) => setImportantPeople(e.target.value)}
              />
              <p className="text-xs text-black/50">
                List the key people in your child&apos;s life e.g. Mum, Dad,
                Gran, class teacher
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-brand-neutral-black">
                Diagnosis
              </label>
              <DiagnosisSelect
                selected={diagnoses}
                onToggle={toggleDiagnosis}
                otherValue={diagnosisOther}
                onOtherChange={setDiagnosisOther}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-brand-neutral-black">
                Which county do you call home?
              </label>
              <select
                value={countyId}
                onChange={(e) => setCountyId(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              >
                <option value="">Select a county</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-black/50">
                This helps us understand where support is needed most.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <Button type="submit" disabled={isSaving} className="mt-2">
              {isSaving ? "Saving…" : "Save and continue"}
            </Button>
          </form>

          <button
            type="button"
            onClick={handleSaveAndExit}
            disabled={isSaving}
            className="mt-4 w-full text-center text-sm font-semibold text-black/50 disabled:opacity-50"
          >
            Save and exit
          </button>
        </div>
      </div>
    </main>
  );
}
