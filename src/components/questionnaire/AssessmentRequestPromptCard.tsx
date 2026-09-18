"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getChildDisplayName } from "@/lib/childDisplayName";
import { AssessmentResponseFlow, type MyAssessmentToComplete } from "./AssessmentResponseFlow";

interface AssessmentRow {
  id: string;
  child_name: string;
  instrument_name: string;
  clinician_name: string;
  instruction: string | null;
  assigned_at: string;
  last_reminded_at: string | null;
}

function mapRow(row: AssessmentRow): MyAssessmentToComplete {
  return {
    id: row.id,
    childName: row.child_name,
    instrumentName: row.instrument_name,
    clinicianName: row.clinician_name,
    instruction: row.instruction,
    assignedAt: row.assigned_at,
    lastRemindedAt: row.last_reminded_at,
  };
}

// The respondent-side counterpart to QuestionnairePromptCard -- same
// self-contained shape (fetches its own data, renders nothing while
// loading or empty, owns the completion flow's open/closed state) so
// dropping it into a dashboard is the only integration needed. Unlike
// QuestionnairePromptCard there is no "cancelled" branch to render --
// an assessment that's been completed (by the clinician, or by this
// respondent submitting their last answer) simply stops being
// returned by get_my_assessments_to_complete() at all, per 0239's own
// single-respondent design; there's no separate cancelled state to
// explain here the way finalize_fba_report()'s auto-cancel needed one
// for fba_instrument_requests.
export function AssessmentRequestPromptCard({
  className = "",
}: {
  className?: string;
}) {
  const [requests, setRequests] = useState<MyAssessmentToComplete[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeRequest, setActiveRequest] = useState<MyAssessmentToComplete | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_assessments_to_complete");
    if (error) {
      console.error("Failed to load assessment prompts:", error);
      setIsLoading(false);
      return;
    }
    setRequests(((data ?? []) as AssessmentRow[]).map(mapRow));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (isLoading || requests.length === 0) {
    return null;
  }

  const stackClassName = `flex flex-col gap-3 ${className}`;

  return (
    <>
      <div className={stackClassName}>
        {requests.map((request) => (
          // Same golden "please act today" treatment as
          // QuestionnairePromptCard -- a distinct icon (📝) keeps the
          // two visually distinguishable when both are stacked on the
          // same dashboard.
          <button
            key={request.id}
            type="button"
            onClick={() => setActiveRequest(request)}
            className="flex w-full items-center gap-3 rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 text-left shadow-md transition-transform active:scale-[0.99]"
          >
            <span
              aria-hidden
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-golden-brown/20 text-lg animate-pulse"
            >
              📝
            </span>
            <span className="flex-1 text-sm font-semibold text-brand-neutral-black">
              {request.clinicianName} has asked you to fill out a {request.instrumentName} for{" "}
              {getChildDisplayName(request.childName)}
            </span>
            <span
              aria-hidden
              className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white"
            >
              Start
            </span>
          </button>
        ))}
      </div>

      {activeRequest && (
        <AssessmentResponseFlow
          assessmentId={activeRequest.id}
          onClose={() => {
            setActiveRequest(null);
            load();
          }}
        />
      )}
    </>
  );
}
