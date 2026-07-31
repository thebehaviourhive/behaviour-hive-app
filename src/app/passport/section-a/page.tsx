"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";

const DIAGNOSIS_OPTIONS: { value: string; fullName: string | null }[] = [
  { value: "ADHD", fullName: "Attention Deficit Hyperactivity Disorder" },
  { value: "ASD", fullName: "Autism Spectrum Disorder" },
  { value: "Autism", fullName: null },
  { value: "Apraxia", fullName: null },
  { value: "DLD", fullName: "Developmental Language Disorder" },
  { value: "DMDD", fullName: "Disruptive Mood Dysregulation Disorder" },
  { value: "Dyscalculia", fullName: null },
  { value: "Dysgraphia", fullName: null },
  { value: "Dyslexia", fullName: null },
  { value: "Dyspraxia", fullName: null },
  { value: "FASD", fullName: "Foetal Alcohol Spectrum Disorder" },
  { value: "GDD", fullName: "Global Developmental Delay" },
  { value: "Intellectual Disability", fullName: null },
  { value: "ODD", fullName: "Oppositional Defiant Disorder" },
  { value: "PDA", fullName: "Pathological Demand Avoidance" },
  { value: "Physical Disability", fullName: null },
  { value: "SPD", fullName: "Sensory Processing Disorder" },
  { value: "Tourette Syndrome", fullName: null },
  { value: "Other", fullName: null },
];

export default function PassportSectionAPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("parent");

  const [childName, setChildName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [school, setSchool] = useState("");
  const [importantPeople, setImportantPeople] = useState("");
  const [diagnoses, setDiagnoses] = useState<string[]>([]);
  const [diagnosisOther, setDiagnosisOther] = useState("");

  const [isLoadingExisting, setIsLoadingExisting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!user) return;

    let isMounted = true;

    async function loadExisting() {
      const supabase = createClient();
      const { data } = await supabase
        .from("passports")
        .select(
          "child_name, date_of_birth, school, important_people, diagnoses, diagnosis_other"
        )
        .eq("user_id", user!.id)
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
      setIsLoadingExisting(false);
    }

    loadExisting();
    return () => {
      isMounted = false;
    };
  }, [user]);

  function toggleDiagnosis(value: string) {
    setDiagnoses((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function buildPayload() {
    return {
      user_id: user!.id,
      child_name: childName || null,
      date_of_birth: dateOfBirth || null,
      school: school || null,
      important_people: importantPeople || null,
      diagnoses: diagnoses.length > 0 ? diagnoses : null,
      diagnosis_other: diagnoses.includes("Other") ? diagnosisOther || null : null,
      passport_status: "in_progress" as const,
    };
  }

  async function handleSaveAndContinue(event: FormEvent) {
    event.preventDefault();
    if (!user) return;

    setError(null);
    setIsSaving(true);

    const supabase = createClient();
    const { error: upsertError } = await supabase
      .from("passports")
      .upsert(
        { ...buildPayload(), section_a_complete: true },
        { onConflict: "user_id" }
      );

    setIsSaving(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    router.push("/passport/section-b");
  }

  async function handleSaveAndExit() {
    if (!user) return;

    setError(null);
    setIsSaving(true);

    const supabase = createClient();
    const { error: upsertError } = await supabase
      .from("passports")
      .upsert(buildPayload(), { onConflict: "user_id" });

    setIsSaving(false);

    if (upsertError) {
      setError(upsertError.message);
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
          <div className="mb-5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-black/50">
                Section 1 of 4
              </span>
              <span className="text-xs font-semibold text-brand-prussian-blue">
                25%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
              <div className="h-full w-1/4 rounded-full bg-brand-prussian-blue" />
            </div>
          </div>

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
                label="Important people in my life"
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
              <div className="flex flex-wrap gap-2">
                {DIAGNOSIS_OPTIONS.map((option) => {
                  const isSelected = diagnoses.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      title={option.fullName ?? option.value}
                      onClick={() => toggleDiagnosis(option.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        isSelected
                          ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                          : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
                      }`}
                    >
                      {option.value}
                    </button>
                  );
                })}
              </div>

              {diagnoses.includes("Other") && (
                <TextField
                  label="Please specify"
                  type="text"
                  placeholder="Diagnosis not listed above"
                  value={diagnosisOther}
                  onChange={(e) => setDiagnosisOther(e.target.value)}
                  className="mt-1"
                />
              )}
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
