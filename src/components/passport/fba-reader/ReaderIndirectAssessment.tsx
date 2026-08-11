"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { NarrativeField } from "@/components/clinician/fba/NarrativeField";
import { InstrumentResultCard } from "@/components/clinician/fba/sections/indirect/InstrumentResultCard";
import { FaiInterviewReadOnly } from "@/components/clinician/fba/sections/indirect/FaiInterviewReadOnly";
import { FbaNote } from "@/components/clinician/fba/FbaNote";
import type {
  FbaContentData,
  InstrumentRequestStatus,
  InstrumentResponsesData,
  InstrumentRequestType,
} from "@/lib/fba/types";

interface RequestRow {
  id: string;
  instrument_type: InstrumentRequestType;
  status: InstrumentRequestStatus;
  responses_data: InstrumentResponsesData;
}

// Section 7 for the parent reader (Part C). Reads fba_instrument_requests
// directly -- the parent's own SELECT policy (migration 0042) is scoped
// to completed FBAs only, so this never needs the clinician-only
// get_fba_instrument_requests RPC (which would return zero rows for a
// parent caller anyway). No recipient-name resolution is available
// outside that RPC, so results render without the "Completed by X"
// attribution line -- a deliberate simplification, not a bug.
export function ReaderIndirectAssessment({ fbaId, content }: { fbaId: string; content: FbaContentData }) {
  const [requests, setRequests] = useState<RequestRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("fba_instrument_requests")
      .select("id, instrument_type, status, responses_data")
      .eq("fba_id", fbaId)
      .eq("status", "completed")
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to load questionnaire results:", error);
          setLoadError("Couldn't load questionnaire results.");
          return;
        }
        setRequests((data ?? []) as RequestRow[]);
      });
    return () => {
      isMounted = false;
    };
  }, [fbaId]);

  return (
    <div className="flex flex-col gap-6">
      <NarrativeField
        value={content.openEndedInterviewNotes ?? ""}
        onChange={() => {}}
        onBlur={() => {}}
        readOnly
        rows={10}
      />

      <FaiInterviewReadOnly interviews={content.faiInterviews ?? []} />

      {loadError ? (
        <p className="text-sm text-red-600">{loadError}</p>
      ) : requests === null ? (
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      ) : requests.length === 0 ? (
        <FbaNote>No questionnaire results for this assessment.</FbaNote>
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((request) => (
            <InstrumentResultCard
              key={request.id}
              request={{
                id: request.id,
                instrumentType: request.instrument_type,
                recipientId: "",
                status: request.status,
                responsesData: request.responses_data,
                createdAt: "",
                completedAt: null,
                lastRemindedAt: null,
              }}
              interpretation={content.instrumentInterpretations?.[request.id] ?? ""}
              onInterpretationChange={() => {}}
              onInterpretationBlur={() => {}}
              readOnly
              showAttribution={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
