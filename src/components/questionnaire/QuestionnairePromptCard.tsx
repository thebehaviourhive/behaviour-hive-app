"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getChildDisplayName } from "@/lib/childDisplayName";
import type { MyInstrumentRequest } from "@/lib/fba/types";
import { QuestionnaireFlow } from "./QuestionnaireFlow";

interface RequestRow {
  id: string;
  fba_id: string;
  instrument_type: MyInstrumentRequest["instrumentType"];
  status: MyInstrumentRequest["status"];
  child_name: string;
  clinician_name: string;
  created_at: string;
}

function mapRow(row: RequestRow): MyInstrumentRequest {
  return {
    id: row.id,
    fbaId: row.fba_id,
    instrumentType: row.instrument_type,
    status: row.status,
    childName: row.child_name,
    clinicianName: row.clinician_name,
    createdAt: row.created_at,
  };
}

// Self-contained: fetches its own data, renders nothing while loading or
// when there's nothing pending, and owns the completion flow's open/
// closed state internally -- so dropping <QuestionnairePromptCard /> in
// above a dashboard's Recent Activity card is the only integration
// needed, with zero other wiring and zero risk to the rest of the page.
// A load failure fails silently (logged, not shown) rather than putting
// an alarming error card above Recent Activity for something outside
// the recipient's control -- this is a "nice to have" prompt, not core
// dashboard content.
export function QuestionnairePromptCard({ track }: { track: "parent" | "teacher" }) {
  const [requests, setRequests] = useState<MyInstrumentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeRequest, setActiveRequest] = useState<MyInstrumentRequest | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_instrument_requests");
    if (error) {
      console.error("Failed to load questionnaire prompts:", error);
      setIsLoading(false);
      return;
    }
    setRequests(((data ?? []) as RequestRow[]).map(mapRow));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (isLoading || requests.length === 0) {
    return null;
  }

  // mb-6 matches the sibling cards' own self-supplied bottom margin in
  // both tracks (RecentUpdatesCard on parent, TeacherActivityCard on
  // teacher) -- and since this component returns null above when
  // there's nothing to show, that margin never renders as a stray gap
  // on the far more common empty case.
  const cardClassName = `mb-6 rounded-2xl border border-brand-off-white/50 border-t-4 border-t-brand-prussian-blue bg-white p-5 shadow-sm ${
    track === "teacher" ? "mx-4" : ""
  }`;

  return (
    <>
      <div className={cardClassName}>
        {requests.map((request, index) => {
          const childLabel = track === "teacher" ? getChildDisplayName(request.childName) : request.childName;
          return (
            <div key={request.id} className={index > 0 ? "mt-4 border-t border-black/5 pt-4" : ""}>
              <p className="text-sm text-brand-neutral-black">
                <span className="font-semibold">{request.clinicianName}</span> has asked you to
                complete a short questionnaire about{" "}
                <span className="font-semibold">{childLabel}</span>.
              </p>
              <button
                type="button"
                onClick={() => setActiveRequest(request)}
                className="mt-3 w-full rounded-2xl bg-brand-prussian-blue py-3 text-sm font-semibold text-white"
              >
                {request.status === "in_progress" ? "Continue" : "Start"}
              </button>
            </div>
          );
        })}
      </div>

      {activeRequest && (
        <QuestionnaireFlow
          request={activeRequest}
          track={track}
          onClose={() => {
            setActiveRequest(null);
            load();
          }}
          onComplete={() => {
            setActiveRequest(null);
            load();
          }}
        />
      )}
    </>
  );
}
