"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { useAssessments } from "@/hooks/useAssessments";
import { NewAssessmentSheet } from "@/components/clinician/assessments/NewAssessmentSheet";
import type { AssessmentRecordType } from "@/hooks/useAssessmentInstruments";

const RECORD_TYPE_LABEL: Record<AssessmentRecordType, string> = {
  response_sheet: "Response sheet",
  external_record: "External record",
  built_in_full: "Built in full",
};

// PRD 7 Stage 1 -- the Clinical File's own Assessments tab. Never lists
// an FBA -- an FBA never gets a row in the assessments table (see
// NewAssessmentSheet's own header comment); the FBA tab elsewhere on
// this page is where a completed FBA is read.
export function ClinicalFileAssessmentsTab({ passportId, clinicianId }: { passportId: string; clinicianId: string }) {
  const router = useRouter();
  const { assessments, loadError, reload } = useAssessments(passportId);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setIsPickerOpen(true)}
        className="w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-sm font-semibold text-white lg:w-auto lg:px-6"
      >
        + New Assessment
      </button>

      {assessments === null ? (
        loadError ? (
          <InlineErrorState message={loadError} onRetry={reload} />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        )
      ) : assessments.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
          <p className="text-sm text-brand-neutral-black/70">No assessments for this child yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {assessments.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => router.push(`/clinician/passport/${passportId}/assessment/${a.id}`)}
              className="rounded-2xl border border-black/5 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-brand-pastel-blue"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-brand-neutral-black">{a.instrumentName}</p>
                {a.completedAt ? (
                  <span className="flex-shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                    Completed
                  </span>
                ) : (
                  <span className="flex-shrink-0 rounded-full bg-brand-golden-brown/15 px-2.5 py-0.5 text-xs font-semibold text-brand-golden-brown">
                    In progress
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                {RECORD_TYPE_LABEL[a.recordType]} · {formatAssessmentDate(a.assessmentDate)}
              </p>
            </button>
          ))}
        </div>
      )}

      <NewAssessmentSheet
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        passportId={passportId}
        clinicianId={clinicianId}
      />
    </div>
  );
}

function formatAssessmentDate(sessionDate: string): string {
  const [year, month, day] = sessionDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
}
