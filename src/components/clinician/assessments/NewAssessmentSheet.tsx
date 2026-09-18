"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { useAssessmentInstruments, type AssessmentInstrument } from "@/hooks/useAssessmentInstruments";
import { logActivity } from "@/lib/logActivity";
import { formatClinicianReference } from "@/lib/clinicianDisplayName";

const UNIQUE_VIOLATION = "23505";

const RECORD_TYPE_LABEL: Record<AssessmentInstrument["recordType"], string> = {
  response_sheet: "Response sheet",
  external_record: "External record",
  built_in_full: "Built in full",
};

// PRD 7 Stage 1 -- "pick instrument", the step the form shape follows
// from, never a user choice past this point. Tapping FBA replicates
// clinician/fba/page.tsx's own creation logic (a plain insert into
// fba_reports, the same unique-violation handling, the same
// fba_started activity log entry) scoped to THIS passport, then routes
// into the existing FBA builder unchanged -- it never creates a row in
// the new assessments table, which the DB itself refuses outright
// (assessments_set_record_type()) as a second, structural guarantee
// behind this client-side branch. Every other instrument creates a
// bare assessments row (instrument_id + passport_id + clinician_id;
// record_type is set by the trigger, never sent here) and navigates
// straight into its own editor for it -- the row's own existence is
// what makes "started during, finished after" work, same reasoning as
// ClinicalFileSessionNotesTab's own "+ New Session Note".
export function NewAssessmentSheet({
  isOpen,
  onClose,
  passportId,
  clinicianId,
}: {
  isOpen: boolean;
  onClose: () => void;
  passportId: string;
  clinicianId: string;
}) {
  const router = useRouter();
  const { instruments, loadError, reload } = useAssessmentInstruments();
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handlePick(instrument: AssessmentInstrument) {
    setIsCreating(true);
    setCreateError(null);
    const supabase = createClient();

    if (instrument.recordType === "built_in_full") {
      const { data, error } = await supabase
        .from("fba_reports")
        .insert({
          passport_id: passportId,
          clinician_id: clinicianId,
          status: "draft",
          content_data: { reportDate: new Date().toISOString().slice(0, 10) },
        })
        .select("id")
        .single();

      if (error || !data) {
        setIsCreating(false);
        if (error?.code === UNIQUE_VIOLATION) {
          setCreateError("An active FBA already exists for this child.");
        } else {
          console.error("Failed to create FBA:", error);
          setCreateError("Couldn't start a new FBA. Please try again.");
        }
        return;
      }

      const { data: clinicianRow } = await supabase
        .from("clinicians")
        .select("full_name, specialty")
        .eq("user_id", clinicianId)
        .maybeSingle();

      logActivity({
        passportId,
        actorId: clinicianId,
        eventType: "fba_started",
        eventDescription: `Functional Behaviour Assessment started by ${formatClinicianReference(clinicianRow?.full_name, clinicianRow?.specialty)}`,
      });

      router.push(`/clinician/fba/${data.id}`);
      return;
    }

    const { data, error } = await supabase
      .from("assessments")
      .insert({ passport_id: passportId, clinician_id: clinicianId, instrument_id: instrument.id })
      .select("id")
      .single();

    setIsCreating(false);

    if (error || !data) {
      console.error("Failed to start an assessment:", error);
      setCreateError("Couldn't start a new assessment. Please try again.");
      return;
    }

    router.push(`/clinician/passport/${passportId}/assessment/${data.id}`);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={() => !isCreating && onClose()}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">New assessment</h2>
      <p className="mt-1 text-sm text-brand-neutral-black/60">Pick an instrument. The form follows from what it is.</p>

      {createError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {createError}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {instruments === null ? (
          loadError ? (
            <InlineErrorState message={loadError} onRetry={reload} />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="h-14 animate-pulse rounded-xl bg-brand-off-white/50" />
              <div className="h-14 animate-pulse rounded-xl bg-brand-off-white/50" />
            </div>
          )
        ) : (
          instruments.map((instrument) => (
            <button
              key={instrument.id}
              type="button"
              onClick={() => handlePick(instrument)}
              disabled={isCreating}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-left transition-colors hover:border-brand-pastel-blue disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-sm font-semibold text-brand-neutral-black">{instrument.name}</span>
              <span className="flex-shrink-0 rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-semibold text-brand-neutral-black/50">
                {RECORD_TYPE_LABEL[instrument.recordType]}
              </span>
            </button>
          ))
        )}
      </div>
    </BottomSheet>
  );
}
