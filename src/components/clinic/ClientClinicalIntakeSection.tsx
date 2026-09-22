"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TextField } from "@/components/ui/TextField";
import { Button } from "@/components/ui/Button";

// Client Info (clinic-only), Daniel's decisions, Sept 2026. Never
// imported into any admin-facing surface -- clinic_admin has no RLS
// path to client_clinical_intake in either direction (see migration
// 0287), so this component simply never appears on
// /clinic-admin/client/[passportId] at all, not merely hidden.
//
// suspected_diagnosis lives here and nowhere else -- see 0287's own
// header for why nothing ever copies it into passports.diagnoses.
// PLAN A: no parent ever sees this component. It is never rendered on
// /passport/claim or any parent-facing page.

interface ClinicalIntake {
  suspectedDiagnosis: string;
  mainConcerns: string;
  previousSupport: boolean | null;
  previousSupportDescription: string;
  clinicGoals: string;
  additionalNotes: string;
}

const EMPTY: ClinicalIntake = {
  suspectedDiagnosis: "",
  mainConcerns: "",
  previousSupport: null,
  previousSupportDescription: "",
  clinicGoals: "",
  additionalNotes: "",
};

export function ClientClinicalIntakeSection({ passportId }: { passportId: string }) {
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [fields, setFields] = useState<ClinicalIntake>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .in("role", ["principal", "clinician"])
      .limit(1)
      .maybeSingle();

    if (!staffRow) {
      setLoadError("Could not find your clinic.");
      setIsLoading(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    const { data: row, error } = await supabase
      .from("client_clinical_intake")
      .select(
        "suspected_diagnosis, main_concerns, previous_support, previous_support_description, clinic_goals, additional_notes"
      )
      .eq("passport_id", passportId)
      .eq("institution_id", staffRow.institution_id)
      .maybeSingle();

    if (error) {
      setLoadError(error.message);
      setIsLoading(false);
      return;
    }

    if (row) {
      setFields({
        suspectedDiagnosis: row.suspected_diagnosis ?? "",
        mainConcerns: row.main_concerns ?? "",
        previousSupport: row.previous_support,
        previousSupportDescription: row.previous_support_description ?? "",
        clinicGoals: row.clinic_goals ?? "",
        additionalNotes: row.additional_notes ?? "",
      });
    }
    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function updateField<K extends keyof ClinicalIntake>(key: K, value: ClinicalIntake[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setSavedNotice(false);
  }

  async function handleSave() {
    if (!institutionId) return;
    setIsSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_client_clinical_intake", {
      p_passport_id: passportId,
      p_institution_id: institutionId,
      p_suspected_diagnosis: fields.suspectedDiagnosis,
      p_main_concerns: fields.mainConcerns,
      p_previous_support: fields.previousSupport,
      p_previous_support_description: fields.previousSupportDescription,
      p_clinic_goals: fields.clinicGoals,
      p_additional_notes: fields.additionalNotes,
    });
    setIsSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setSavedNotice(true);
  }

  if (isLoading) {
    return <div className="h-[280px] animate-pulse rounded-2xl bg-white" />;
  }
  if (loadError) {
    return <p className="text-sm text-brand-neutral-black/60">{loadError}</p>;
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
        Clinical Intake
      </h2>
      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <TextField
            label="Suspected diagnosis"
            value={fields.suspectedDiagnosis}
            onChange={(e) => updateField("suspectedDiagnosis", e.target.value)}
          />
          <p className="-mt-2 text-xs text-brand-neutral-black/50">
            Never shared with a school, and never becomes a formal diagnosis on the passport.
          </p>
          <TextField
            label="Main concerns or behaviours"
            value={fields.mainConcerns}
            onChange={(e) => updateField("mainConcerns", e.target.value)}
          />

          <div>
            <p className="mb-1.5 text-sm font-semibold text-brand-neutral-black">Previous support or services</p>
            <div className="flex gap-2">
              {[
                { label: "Yes", value: true },
                { label: "No", value: false },
              ].map((option) => {
                const isSelected = fields.previousSupport === option.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => updateField("previousSupport", option.value)}
                    aria-pressed={isSelected}
                    className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                      isSelected
                        ? "border-brand-prussian-blue bg-brand-pastel-blue/40 text-brand-prussian-blue"
                        : "border-black/10 bg-white text-brand-neutral-black/60"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <TextField
            label="Description of previous support"
            value={fields.previousSupportDescription}
            onChange={(e) => updateField("previousSupportDescription", e.target.value)}
          />
          <TextField
            label="What they want from working with the clinic"
            value={fields.clinicGoals}
            onChange={(e) => updateField("clinicGoals", e.target.value)}
          />
          <TextField
            label="Anything else they want the clinic to know"
            value={fields.additionalNotes}
            onChange={(e) => updateField("additionalNotes", e.target.value)}
          />
        </div>

        {saveError && (
          <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
            {saveError}
          </p>
        )}
        {savedNotice && !saveError && <p className="mt-3 text-sm font-medium text-green-700">Saved.</p>}

        <Button type="button" onClick={handleSave} disabled={isSaving} className="mt-4 lg:w-auto">
          {isSaving ? "Saving…" : "Save Clinical Intake"}
        </Button>
      </div>
    </section>
  );
}
