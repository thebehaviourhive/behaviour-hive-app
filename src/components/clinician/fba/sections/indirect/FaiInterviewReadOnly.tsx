"use client";

import { useFaiInstrument } from "@/hooks/useFaiInstrument";
import { FAI_ITEM_IDS, type FaiInterview } from "@/lib/fba/types";

// The finalized reader (parent) and PDF views of the Open-Ended FAI --
// one Q&A block per respondent, headed by their name/relation (pulled
// from items 3-4), with the attribution line shown exactly once beneath
// the section heading. Never rendered in the clinician's own workspace
// editing UI (that's the compact tappable list in
// IndirectAssessmentSection.tsx + the full-screen form) -- only here,
// where the interview is being read rather than edited.
export function FaiInterviewReadOnly({ interviews }: { interviews: FaiInterview[] }) {
  const { items, attribution, loadError } = useFaiInstrument();

  if (interviews.length === 0) {
    return null;
  }

  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }

  if (!items) {
    return <div className="h-24 animate-pulse rounded-2xl bg-white" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-heading text-base font-bold text-brand-neutral-black">
          Open-Ended Functional Assessment Interview
        </p>
        {attribution && <p className="mt-1 text-xs italic text-brand-neutral-black/50">{attribution}</p>}
      </div>

      {interviews.map((interview) => {
        const respondentName = interview.answers[FAI_ITEM_IDS.respondentName]?.trim() || "Respondent";
        const respondentRelation = interview.answers[FAI_ITEM_IDS.respondentRelation]?.trim();

        return (
          <div key={interview.id} className="print-avoid-break rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <p className="font-heading text-sm font-bold text-brand-prussian-blue">{respondentName}</p>
            {respondentRelation && (
              <p className="mb-3 text-xs text-brand-neutral-black/50">{respondentRelation}</p>
            )}
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <div key={item.id}>
                  <p className="text-sm font-semibold text-brand-neutral-black">{item.text}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-brand-neutral-black/70">
                    {interview.answers[item.id]?.trim() || (
                      <span className="text-black/30">No answer given.</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
