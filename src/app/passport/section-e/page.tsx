"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { PassportProgress } from "@/components/ui/PassportProgress";
import { usePassportSectionE } from "@/hooks/usePassportSectionE";
import { getPassportProgressPercent } from "@/lib/passportProgress";

// Section E -- medical and intimate care needs. Five discrete fields,
// one page (matching Section A/C's own single-page shape, not Section
// D's multi-step wizard) -- a cover teacher scanning before a lesson
// needs to find one thing fast, which is a display-side concern, not a
// reason to split this into five separate pages for the parent filling
// it in.
export default function PassportSectionEPage() {
  const router = useRouter();
  const { record, isReady, save } = usePassportSectionE();

  const [allergies, setAllergies] = useState("");
  const [medicalConditions, setMedicalConditions] = useState("");
  const [medications, setMedications] = useState("");
  const [emergencyProtocol, setEmergencyProtocol] = useState("");
  const [intimateCareNeeds, setIntimateCareNeeds] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  if (isReady && !hasHydrated) {
    setHasHydrated(true);
    setAllergies(record.allergies ?? "");
    setMedicalConditions(record.medical_conditions ?? "");
    setMedications(record.medications ?? "");
    setEmergencyProtocol(record.emergency_protocol ?? "");
    setIntimateCareNeeds(record.intimate_care_needs ?? "");
  }

  function buildUpdates(markComplete: boolean) {
    return {
      allergies: allergies.trim() || null,
      medical_conditions: medicalConditions.trim() || null,
      medications: medications.trim() || null,
      emergency_protocol: emergencyProtocol.trim() || null,
      intimate_care_needs: intimateCareNeeds.trim() || null,
      section_e_complete: markComplete ? true : record.section_e_complete,
    };
  }

  async function handleDone() {
    setError(null);
    setIsSaving(true);
    const saveError = await save(buildUpdates(true));
    setIsSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    router.push("/parent-dashboard");
  }

  async function handleSaveAndExit() {
    setError(null);
    setIsSaving(true);
    const saveError = await save(buildUpdates(false));
    setIsSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    router.push("/parent-dashboard");
  }

  if (!isReady) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <button
          type="button"
          onClick={() => router.push("/parent-dashboard")}
          disabled={isSaving}
          aria-label="Back"
          className="mb-2 text-2xl leading-none text-brand-prussian-blue disabled:opacity-50"
        >
          ‹
        </button>

        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Medical &amp; Care Needs
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <PassportProgress sectionLabel="Section 5 of 5" percent={getPassportProgressPercent(10)} />

          <p className="mb-4 text-sm text-black/60">
            This is what a teacher or SNA covering your child&apos;s class needs to know quickly —
            allergies, medical conditions, medication, and what to do in an emergency.
          </p>

          <div className="flex flex-col gap-4">
            <Textarea
              label="Allergies"
              id="section-e-allergies"
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              placeholder="Any allergies, and what happens if exposed"
            />
            <Textarea
              label="Medical conditions relevant to daily care"
              id="section-e-medical-conditions"
              value={medicalConditions}
              onChange={(e) => setMedicalConditions(e.target.value)}
              placeholder="e.g. epilepsy, asthma, diabetes"
            />
            <Textarea
              label="Medications"
              id="section-e-medications"
              value={medications}
              onChange={(e) => setMedications(e.target.value)}
              placeholder="Include anything given during the school day"
            />
            <Textarea
              label="Emergency protocol"
              id="section-e-emergency-protocol"
              value={emergencyProtocol}
              onChange={(e) => setEmergencyProtocol(e.target.value)}
              placeholder="What to do, who to call, in what order"
            />
            <Textarea
              label="Intimate care needs"
              id="section-e-intimate-care"
              value={intimateCareNeeds}
              onChange={(e) => setIntimateCareNeeds(e.target.value)}
              placeholder="Described plainly, so staff know what to do"
            />
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button type="button" onClick={handleDone} disabled={isSaving} className="mt-6">
            {isSaving ? "Saving…" : "Done"}
          </Button>

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
